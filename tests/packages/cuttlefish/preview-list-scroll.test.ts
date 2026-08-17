// Virtualized list mid-scroll regression: the dirty pass used to pre-draw the
// list's outset box shadow (a full-rect paint spanning the element) BEFORE
// drawListNode's shift path, so every shift frame copied shadow-colored pixels
// over the rows and repaired only the exposed bottom strip — items were left
// visible through a small window at the bottom of the list, and only the
// scroll extremes (full-repaint branches) looked right. Lists must draw their
// outset shadow on the full-repaint path only, mirroring the device runtime
// (node-draw-body.ts skips the outset shadow for lists in the main loop).
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

const LIST_BG = 0x333333;
// blend(black, LIST_BG, 50%) — the color the buggy shadow pre-draw left over
// the whole list interior on every shift frame.
const SHADOW_COL = 0x191919;

function makeShadowedListSnapshot(): any {
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
          index: 1, tag: "list", kind: "list", id: "rows",
          box: { x: 10, y: 10, w: 80, h: 50 }, fg: 0xffffff,
          hasBg: true, bg: LIST_BG, clearColor: LIST_BG,
          text: "", listItemHeight: 22, parentIndex: 0, subtreeEnd: 2,
          scrollable: true, virtualized: true,
          // Outset hard shadow (offset 3,3): its rect spans the element, so
          // drawing it over the live viewport destroys the shift source.
          shadowCount: 1, shadowOffsetX: [3], shadowOffsetY: [3],
          shadowBlur: [1], shadowColor: [0x000000], shadowAlpha: [100],
          shadowInset: [false],
        }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0),
    bindings: [],
    listBindings: [{
      nodeId: "rows", nodeIndex: 1, countExpression: "40",
      itemExpression: "'row'", itemParam: "i",
    }],
    callbacks: [],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    diagnostics: [],
  } as any;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("virtualized list mid-scroll (shift path)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("keeps rows across the viewport during shift-and-repair scrolls", async () => {
    const frames: Uint8ClampedArray[] = [];
    const rt = new PreviewUIRuntime(makeShadowedListSnapshot(), {
      onFrame: (rgba) => frames.push(rgba.slice() as Uint8ClampedArray),
    });
    runtimes.push(rt);
    rt.start();
    await wait(80);
    expect(frames.length).toBeGreaterThan(0);

    const W = 100;
    // List interior: inside the box, clear of the 3px outset shadow sliver.
    const interior = { x0: 12, y0: 12, x1: 87, y1: 57 };
    const isCol = (f: Uint8ClampedArray, x: number, y: number, rgb: number): boolean => {
      const p = (y * W + x) * 4;
      return f[p] === ((rgb >> 16) & 0xff) && f[p + 1] === ((rgb >> 8) & 0xff) && f[p + 2] === (rgb & 0xff);
    };
    const analyze = () => {
      const f = frames[frames.length - 1];
      let shadowPx = 0;
      let textPx = 0;
      for (let y = interior.y0; y <= interior.y1; y++) {
        for (let x = interior.x0; x <= interior.x1; x++) {
          if (isCol(f, x, y, SHADOW_COL)) shadowPx++;
          else if (!isCol(f, x, y, LIST_BG)) textPx++;
        }
      }
      return { shadowPx, textPx };
    };

    // Initial full paint: the shadow IS drawn on the full-repaint path — its
    // sliver outside the box must be present (shadow col over screen bg).
    const f0 = frames[frames.length - 1];
    expect(isCol(f0, 92, 30, SHADOW_COL)).toBe(true);
    const initial = analyze();
    expect(initial.shadowPx).toBe(0);
    expect(initial.textPx).toBeGreaterThan(10);

    // Shift frames: a drag (delta 15px) then two wheel ticks (20px, 25px).
    // Each delta is smaller than the viewport, so every frame takes the
    // shift-and-repair path. The bug painted the shadow over the interior
    // before the shift, leaving rows visible only in the repaired strip.
    rt.pointerDown(50, 35);
    rt.pointerMove(50, 20);
    rt.pointerUp();
    await wait(120);
    const afterDrag = analyze();
    expect(afterDrag.shadowPx).toBe(0);
    expect(afterDrag.textPx).toBeGreaterThan(10);
    expect((rt as any).nodes[1].scrollY).toBeGreaterThan(0);

    rt.wheel(50, 35, 20);
    const afterWheel1 = analyze();
    expect(afterWheel1.shadowPx).toBe(0);
    expect(afterWheel1.textPx).toBeGreaterThan(10);

    rt.wheel(50, 35, 25);
    const afterWheel2 = analyze();
    expect(afterWheel2.shadowPx).toBe(0);
    expect(afterWheel2.textPx).toBeGreaterThan(10);
    // Scroll held across frames (no clamp-back against stale contentHeight).
    expect((rt as any).nodes[1].scrollY).toBe(60);

    // Scrollbar track still drawn (dimmed fg 0xffffff & 0x7f7f7f = 0x7f7f7f).
    const fLast = frames[frames.length - 1];
    expect(isCol(fLast, 87, 55, 0x7f7f7f)).toBe(true);
  });
});
