// Spinner recipe: a dot orbiting inside a ring via pure translate keyframes
// (translate lerps continuously — unlike rotate, which only renders exact
// quarter turns). The runtime test drives the animation across a full cycle
// and asserts the dot visits all four orbit corners.
import { describe, it, expect, afterAll } from "vitest";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";

function makeNode(o: Record<string, unknown>): any {
  return {
    index: 0, tag: "view", classes: [], box: { x: 0, y: 0, w: 8, h: 8 }, bg: 0, fg: 0xffff,
    kind: "fill", textBuffer: "", hasTextBinding: false, hasBg: true, textAlign: 0, textSize: 1,
    lineHeight: 8, fontAntialias: false, fontFace: 0, letterSpacing: 0, borderColor: 0,
    borderStyle: 0, borderWidth: 0, borderRadius: 0, gradientEnabled: 0, gradientColor1: 0,
    gradientColor2: 0, outlineColor: 0, outlineStyle: 0, outlineWidth: 0, zIndex: 0,
    transformOffsetX: 0, transformOffsetY: 0, rotateDeg: 0, pressedOffsetX: 0, pressedOffsetY: 0,
    shadowCount: 0, shadowOffsetX: [], shadowOffsetY: [], shadowBlur: [], shadowColor: [],
    shadowAlpha: [], shadowInset: [], textShadowCount: 0, textShadowOffsetX: 0, textShadowOffsetY: 0,
    textShadowBlur: 0, textShadowColor: 0, textShadowAlpha: 0, underline: false, nowrap: false,
    whiteSpaceMode: 0, visible: true, opacity: 100, clearColor: 0, lastTextWidth: 0,
    lastTextHeight: 0, dirty: false, value: 0, scrollable: false, scrollY: 0, contentHeight: 0,
    overscrollPx: 0, settling: false, lastPaintedScrollY: 0, imgDataId: 255, objectFit: 1,
    rangeMin: 0, rangeMax: 100, maxlen: 0, parentIndex: -1, subtreeEnd: 1,
    flowAxis: 0, flowGap: 0, flowFlags: 0, ...o,
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The kit's ui-spinner-orbit stops, as the build lowers them. */
const stop = (percent: number, x: number, y: number) => ({
  percent, props: 8, // KF_TRANSFORM (preview: host-ui-runtime.ts)
  transformOffsetX: x, transformOffsetY: y,
  translatePctX: 0, translatePctY: 0,
  scaleX: 100, scaleY: 100, rotateDeg: 0,
});
const ORBIT_STOPS = [
  stop(0, 0, 0), stop(25, 8, 0), stop(50, 8, 8), stop(75, 0, 8), stop(100, 0, 0),
];

describe("spinner (translate-orbit keyframes, preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("orbits the dot through all four corners over one cycle", async () => {
    const rt: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 60, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", classes: ["spinner"], subtreeEnd: 2, box: { x: 4, y: 4, w: 22, h: 22 }, borderStyle: 1, borderWidth: 2, borderRadius: 11 }),
          makeNode({ index: 1, tag: "view", classes: ["spinner-dot"], id: "dot", parentIndex: 0, subtreeEnd: 2, box: { x: 10, y: 10, w: 6, h: 6 } }),
        ],
        transitions: [],
        animations: [{ node: 1, keyframeSet: 0, durationMs: 1000, delayMs: 0, iterations: -1, baseWidth: 6, baseHeight: 6, originX: 50, originY: 50, timingFunction: 0 }],
        keyframeSets: [{ stops: ORBIT_STOPS }],
      },
      font: new Uint8Array(0),
      bindings: [], listBindings: [], callbacks: [], initialAssignments: [],
      intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtimes.push(rt);
    rt.start();
    await wait(60);

    const dot = () => rt.nodes.find((n: any) => n.id === "dot");
    // Sample the orbit at quarter-cycle spacing: each corner (and the
    // continuous glide between them) must show up as distinct offsets.
    const visited = new Set<string>();
    for (let t = 0; t < 24; t++) {
      rt.tick(42); // ~42ms per tick → full 1000ms cycle over 24 ticks
      await wait(1);
      const n = dot();
      visited.add(`${Math.round(n.transformOffsetX / 4)},${Math.round(n.transformOffsetY / 4)}`);
    }
    // Corners of the 8px orbit in 4px units: (0,0) (2,0) (2,2) (0,2).
    expect(visited.has("0,0")).toBe(true);
    expect(visited.has("2,0")).toBe(true);
    expect(visited.has("2,2")).toBe(true);
    expect(visited.has("0,2")).toBe(true);
    // Midpoints exist too (translate lerps continuously — no stepping).
    expect(visited.size).toBeGreaterThan(6);
  });
});
