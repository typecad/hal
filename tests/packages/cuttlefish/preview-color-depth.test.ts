// Preview color-depth parity: rgb888/rgb666 targets store packed RGB888 in
// the host framebuffer; the canvas push must not reinterpret them as 565
// (the bug rendered native_demo's dark theme channel-shifted: blue screen,
// greenish cards, crimson borders). Transitions/keyframes must lerp at the
// active depth too.
import { describe, it, expect, afterAll } from "vitest";
import { HostAdafruitGFX } from "../../../packages/ui/src/preview/host-gfx";
import { PreviewUIRuntime, lerpColor } from "../../../packages/ui/src/preview/host-ui-runtime";

function makeNode(o: Record<string, unknown>): any {
  return {
    index: 0,
    tag: "view",
    classes: [],
    box: { x: 0, y: 0, w: 8, h: 8 },
    bg: 0,
    fg: 0xffff,
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

function makeSnapshot(colorFormat: string, bg: number): any {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 8,
      height: 8,
      colorFormat,
      nodes: [
        makeNode({ index: 0, tag: "screen", kind: "fill", bg, hasBg: true, subtreeEnd: 1, box: { x: 0, y: 0, w: 8, h: 8 } }),
      ],
      transitions: [],
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

describe("host gfx storage modes", () => {
  it("rgb888 storage emits packed 888 channels directly", () => {
    const gfx = new HostAdafruitGFX(1, 1);
    gfx.setStorageMode("rgb888");
    gfx.fillRect(0, 0, 1, 1, 0x111418);
    const px = gfx.toRgbaBytes();
    expect([px[0], px[1], px[2], px[3]]).toEqual([0x11, 0x14, 0x18, 255]);
  });

  it("default 565 storage still unpacks (regression)", () => {
    const gfx = new HostAdafruitGFX(1, 1);
    gfx.fillRect(0, 0, 1, 1, 0xf800);  // 565 pure red
    const px = gfx.toRgbaBytes();
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });

  it("fillRoundRect pills stay inside their box (no 1px arc overshoot)", () => {
    // h == 2r pills (shadcn .badge / border-radius: 999px clamped): the delta
    // passed to fillCircleHelper must NOT be clamped at 0 — the helper's +1
    // makes it 0 for h == 2r, and a pre-clamped 0 became 1, drawing every
    // corner arc one row past the box (orphan stubs flanking a background
    // line under the badge's straight bottom edge).
    const gfx = new HostAdafruitGFX(80, 32);
    gfx.fillScreen(0x0000);
    gfx.fillRoundRect(10, 5, 62, 20, 10, 0xffff);
    const px = gfx.toRgbaBytes();
    const W = 80;
    const isWhite = (x: number, y: number): boolean => {
      const i = (y * W + x) * 4;
      return px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255;
    };
    // Nothing outside the box rows (5..24).
    for (const y of [4, 25]) {
      for (let x = 0; x < W; x++) expect(isWhite(x, y)).toBe(false);
    }
    // The straight bottom edge inside the box is complete (corner insets are
    // rounded by design; the strip between them must be solid).
    for (let x = 22; x <= 60; x++) {
      expect(isWhite(x, 24)).toBe(true);
      expect(isWhite(x, 5)).toBe(true);
    }
  });

  it("rgb666 storage quantizes channels to 6 bits at the push", () => {
    const gfx = new HostAdafruitGFX(1, 1);
    gfx.setStorageMode("rgb666");
    // 0xff → 6-bit 63 → 8-bit 255; 0x02 → 6-bit 0; 0x05 → 6-bit 1 → 4.
    gfx.fillRect(0, 0, 1, 1, 0xff0205);
    const px = gfx.toRgbaBytes();
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 4]);
  });
});

describe("preview runtime color depth", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("renders an rgb888 snapshot's colors without channel shift", async () => {
    const frames: Uint8ClampedArray[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot("rgb888", 0x111418), {
      onFrame: (rgba) => frames.push(rgba.slice() as Uint8ClampedArray),
    });
    runtimes.push(rt);
    rt.start();
    await wait(80);
    expect(frames.length).toBeGreaterThan(0);
    const f = frames[frames.length - 1];
    expect([f[0], f[1], f[2], f[3]]).toEqual([0x11, 0x14, 0x18, 255]);
  });

  it("renders an rgb565 snapshot unchanged (regression)", async () => {
    const frames: Uint8ClampedArray[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot("rgb565", 0x001f), {
      onFrame: (rgba) => frames.push(rgba.slice() as Uint8ClampedArray),
    });
    runtimes.push(rt);
    rt.start();
    await wait(80);
    const f = frames[frames.length - 1];
    expect([f[0], f[1], f[2]]).toEqual([0, 0, 255]);  // 565 blue → 888 blue
  });

  it("lerps colors per-channel at 888 and 565 depths", async () => {
    // Constructing runtimes seeds the module-level format used by lerpColor.
    const rt888 = new PreviewUIRuntime(makeSnapshot("rgb888", 0), {});
    runtimes.push(rt888);
    // 50% between #000000 and #4080c0 → #204060.
    expect(lerpColor(0x000000, 0x4080c0, 50)).toBe(0x204060);
    const rt565 = new PreviewUIRuntime(makeSnapshot("rgb565", 0), {});
    runtimes.push(rt565);
    // 565 stays 16-bit, lerped per 5/6-bit channel: halfway to 0xffff is
    // r=15, g=31, b=15 → (15<<11)|(31<<5)|15 = 0x7BEF (device parity).
    expect(lerpColor(0x0000, 0xffff, 50)).toBe(0x7bef);
  });

  it("dims the list scrollbar track at the active depth (no 565 mask on rgb888)", async () => {
    const makeListSnapshot = (colorFormat: string): any => ({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 100, colorFormat,
        nodes: [
          makeNode({
            index: 0, tag: "list", kind: "list", id: "rows",
            box: { x: 10, y: 10, w: 80, h: 50 }, fg: colorFormat === "rgb888" ? 0xf7f3e8 : 0xffff,
            hasBg: true, bg: colorFormat === "rgb888" ? 0x111418 : 0x0000,
            text: "", listItemHeight: 22, parentIndex: -1, subtreeEnd: 1,
            // Real lowered lists are virtualized — the generic scroll passes
            // must skip them (device parity, dirty-draw-phase.ts) or they
            // overdraw the scrollbar and clamp scrollY against the stale
            // node-level contentHeight.
            scrollable: true, virtualized: true,
          }),
        ],
        transitions: [],
      },
      font: new Uint8Array(0),
      bindings: [], listBindings: [{
        nodeId: "rows", nodeIndex: 0, countExpression: "40",
        itemExpression: `'row'`, itemParam: "i",
      }],
      callbacks: [], initialAssignments: [], intervals: [], pinControls: [],
      diagnostics: [],
    });
    const probe = async (colorFormat: string): Promise<{ track: number[]; rowsAfterDrag: number; scrollY: number }> => {
      const frames: Uint8ClampedArray[] = [];
      const rt = new PreviewUIRuntime(makeListSnapshot(colorFormat), {
        onFrame: (rgba) => frames.push(rgba.slice() as Uint8ClampedArray),
      });
      runtimes.push(rt);
      rt.start();
      // Drag the list up 15px so the scrollbar + row redraw both engage.
      rt.pointerDown(50, 35);
      rt.pointerMove(50, 20);
      rt.pointerUp();
      await wait(150);
      const f = frames[frames.length - 1];
      // Track column x = box.x + box.w - 3; sample below the top thumb (8px).
      const p = ((10 + 30) * 100 + (10 + 80 - 3)) * 4;
      let rows = 0;
      for (let yy = 15; yy < 55; yy += 11) {
        let lit = 0;
        for (let xx = 15; xx < 75; xx++) {
          const q = (yy * 100 + xx) * 4;
          if (f[q] | f[q + 1] | f[q + 2]) lit++;
        }
        if (lit > 5) rows++;
      }
      return { track: [f[p], f[p + 1], f[p + 2]], rowsAfterDrag: rows, scrollY: (rt as any).nodes[0].scrollY };
    };
    const rgb888 = await probe("rgb888");
    // Track = fg 0xf7f3e8 & 0x7f7f7f = 0x777368 — NOT the 565-mask value
    // (0x00,0x7b,0xef) the old double-drawing pass left behind.
    expect(rgb888.track).toEqual([0x77, 0x73, 0x68]);
    // Rows stay visible after the drag and the scroll held (the generic pass
    // used to clamp scrollY back against the stale contentHeight).
    expect(rgb888.rowsAfterDrag).toBeGreaterThan(0);
    expect(rgb888.scrollY).toBeGreaterThan(0);
    // rgb565: fg 0xffff & 0x7bef = 0x7bef, expanded to 888.
    const { rgb565ToRgb888 } = await import("../../../packages/ui/src/preview/host-gfx");
    const { r, g, b } = rgb565ToRgb888(0x7bef);
    expect((await probe("rgb565")).track).toEqual([r, g, b]);
  });
});
