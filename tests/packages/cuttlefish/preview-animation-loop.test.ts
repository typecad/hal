// Preview frame-loop regression: CSS keyframe animations must advance and
// repaint from start()'s own tick poller — the preview equivalent of the
// device's loop() -> ui_tick(). The runtime used to tick only on input events
// and ui.interval bindings, so transform animations froze between clicks
// (geometry advanced internally, the canvas never repainted).
import { describe, it, expect, afterAll } from "vitest";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";

function makeNode(o: Record<string, unknown>): any {
  return {
    index: 0,
    tag: "view",
    classes: [],
    box: { x: 0, y: 0, w: 8, h: 8 },
    bg: 0,
    fg: 0xffffff,
    kind: "fill",
    textBuffer: "",
    hasTextBinding: false,
    hasBg: true,
    textAlign: 0,
    textSize: 1,
    lineHeight: 8,
    fontAntialias: false,
    fontFace: 0,
    letterSpacing: 0,
    borderColor: 0,
    borderStyle: 0,
    borderWidth: 0,
    borderRadius: 0,
    gradientEnabled: 0,
    gradientColor1: 0,
    gradientColor2: 0,
    outlineColor: 0,
    outlineStyle: 0,
    outlineWidth: 0,
    zIndex: 0,
    transformOffsetX: 0,
    transformOffsetY: 0,
    rotateDeg: 0,
    pressedOffsetX: 0,
    pressedOffsetY: 0,
    shadowCount: 0,
    shadowOffsetX: [],
    shadowOffsetY: [],
    shadowBlur: [],
    shadowColor: [],
    shadowAlpha: [],
    shadowInset: [],
    textShadowCount: 0,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
    textShadowBlur: 0,
    textShadowColor: 0,
    textShadowAlpha: 0,
    underline: false,
    nowrap: false,
    whiteSpaceMode: 0,
    visible: true,
    opacity: 100,
    clearColor: 0,
    lastTextWidth: 0,
    lastTextHeight: 0,
    dirty: false,
    value: 0,
    scrollable: false,
    scrollY: 0,
    contentHeight: 0,
    overscrollPx: 0,
    settling: false,
    lastPaintedScrollY: 0,
    imgDataId: 255,
    objectFit: 1,
    rangeMin: 0,
    rangeMax: 100,
    maxlen: 0,
    parentIndex: -1,
    subtreeEnd: 1,
    ...o,
  };
}

const KF_TRANSFORM = 8;

function makeAnimatedSnapshot(): any {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 100,
      height: 100,
      colorFormat: "rgb888",
      nodes: [
        makeNode({
          index: 0, tag: "screen", kind: "fill", bg: 0x111111, hasBg: true,
          box: { x: 0, y: 0, w: 100, h: 100 }, subtreeEnd: 2,
        }),
        makeNode({
          index: 1, tag: "view", kind: "fill", bg: 0xf6c84c, hasBg: true,
          box: { x: 10, y: 40, w: 20, h: 20 }, parentIndex: 0, subtreeEnd: 2,
        }),
      ],
      transitions: [],
      keyframeSets: [{
        stops: [
          { percent: 0, props: KF_TRANSFORM, transformOffsetX: 0, transformOffsetY: 0, rotateDeg: 0, translatePctX: 0, translatePctY: 0, scaleX: 100, scaleY: 100 },
          { percent: 50, props: KF_TRANSFORM, transformOffsetX: 40, transformOffsetY: 0, rotateDeg: 0, translatePctX: 0, translatePctY: 0, scaleX: 100, scaleY: 100 },
          { percent: 100, props: KF_TRANSFORM, transformOffsetX: 0, transformOffsetY: 0, rotateDeg: 0, translatePctX: 0, translatePctY: 0, scaleX: 100, scaleY: 100 },
        ],
      }],
      animations: [{
        node: 1, keyframeSet: 0, durationMs: 600, iterations: -1,
        delayMs: 0, timingFunction: 0, baseWidth: 20, baseHeight: 20,
        originX: 50, originY: 50,
      }],
    },
    font: new Uint8Array(0),
    bindings: [],
    listBindings: [],
    callbacks: [],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    diagnostics: [],
  } as any;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function frameHash(f: Uint8ClampedArray): string {
  let h = 0n;
  for (let i = 0; i < f.length; i += 97) h = (h * 31n + BigInt(f[i])) & 0xffffffffffffn;
  return h.toString(16);
}

describe("preview animation frame loop", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("advances and repaints keyframe animations without any input", async () => {
    const frames: Uint8ClampedArray[] = [];
    const rt = new PreviewUIRuntime(makeAnimatedSnapshot(), {
      onFrame: (rgba) => frames.push(rgba.slice() as Uint8ClampedArray),
    });
    runtimes.push(rt);
    rt.start();
    await wait(320);
    // The ~20ms poller ticked ~15 times; the looping animation repaints on
    // most of them (the old code pushed 1 frame at start and then nothing
    // until a click).
    expect(frames.length).toBeGreaterThanOrEqual(4);
    const uniqueFrames = new Set(frames.map(frameHash));
    expect(uniqueFrames.size).toBeGreaterThanOrEqual(3);
    // Geometry actually animated (the looping translate is mid-oscillation).
    expect((rt as any).nodes[1].transformOffsetX).not.toBe(0);
  });
});
