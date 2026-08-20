// Drawer overlap regression (preview runtime): opening a drawer paints its
// subtree, and tapping a button INSIDE the open drawer (which updates a bound
// text BEHIND the drawer) must not erase the drawer's content. Reproduces the
// hardware report ("text in the drawer disappears; Close button disappears
// but stays tappable") against the same dirty-classification logic the device
// runtime uses. Node fields mirror what the demo lowering emits: text nodes
// have no own background and clear to their parent's backdrop.
import { describe, it, expect, afterAll } from "vitest";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";
import { GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";

function makeNode(o: Record<string, unknown>): any {
  return {
    index: 0, tag: "view", classes: [], box: { x: 0, y: 0, w: 8, h: 8 }, bg: 0, fg: 0xffff,
    kind: "fill", textBuffer: "", hasTextBinding: false, hasBg: false, textAlign: 0, textSize: 1,
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

const W = 100, H = 120;
const DRAWER_Y = 60, DRAWER_H = 56;
const DRAWER_BG = 0xaaaa;
const MAIN_BG = 0x1111;

function makeRuntime(): any {
  return new PreviewUIRuntime({
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: W, height: H, colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", subtreeEnd: 9, box: { x: 0, y: 0, w: W, h: H }, hasBg: true, bg: 0 }),
        makeNode({ index: 1, tag: "view", kind: "fill", id: "main", parentIndex: 0, subtreeEnd: 9, box: { x: 4, y: 4, w: 92, h: 112 }, hasBg: true, bg: MAIN_BG, scrollable: true, scrollY: 60, contentHeight: 200 }),
        makeNode({ index: 2, tag: "text", kind: "text", id: "echo", text: "taps: 0", hasTextBinding: true, parentIndex: 1, subtreeEnd: 2, box: { x: 6, y: 8, w: 88, h: 10 }, clearColor: MAIN_BG }),
        makeNode({ index: 3, tag: "view", kind: "fill", id: "drawer", parentIndex: 1, subtreeEnd: 8, box: { x: 6, y: DRAWER_Y, w: 88, h: DRAWER_H }, hasBg: true, bg: DRAWER_BG, zIndex: 10, drawerSide: 0 }),
        makeNode({ index: 4, tag: "text", kind: "text", id: "dtitle", text: "Drawer title", parentIndex: 3, subtreeEnd: 4, box: { x: 10, y: DRAWER_Y + 4, w: 80, h: 10 }, clearColor: DRAWER_BG, zIndex: 10 }),
        makeNode({ index: 5, tag: "button", kind: "button", id: "tapme", text: "Tap me", parentIndex: 3, subtreeEnd: 5, box: { x: 10, y: DRAWER_Y + 20, w: 40, h: 16 }, hasBg: true, bg: 0x0f0f, zIndex: 10 }),
        makeNode({ index: 6, tag: "button", kind: "button", id: "close", text: "Close", parentIndex: 3, subtreeEnd: 6, box: { x: 54, y: DRAWER_Y + 20, w: 36, h: 16 }, hasBg: true, bg: 0x0f0f, zIndex: 10 }),
        makeNode({ index: 7, tag: "text", kind: "text", id: "ddesc", text: "content", parentIndex: 3, subtreeEnd: 7, box: { x: 10, y: DRAWER_Y + 40, w: 80, h: 10 }, clearColor: DRAWER_BG, zIndex: 10 }),
        makeNode({ index: 8, tag: "text", kind: "text", id: "tail", text: "below", parentIndex: 1, subtreeEnd: 8, box: { x: 6, y: 118, w: 40, h: 8 }, clearColor: MAIN_BG }),
      ],
      transitions: [],
    },
    font: new Uint8Array(GLCDFONT_BYTES.slice(0, 1280) as unknown as number[]),
    bindings: [
      { nodeId: "echo", nodeIndex: 2, property: "text", expression: "taps" },
    ],
    callbacks: [],
    initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    moduleVars: [{ name: "taps", initializer: "0" }],
  } as any);
}

describe("drawer overlap on inner-button tap (preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("drawer content paints on open and survives the echo text update behind it", async () => {
    const rt: any = makeRuntime();
    runtimes.push(rt);
    rt.start();
    rt.drawerOpen("drawer");
    for (let i = 0; i < 30; i++) { rt.tick(16); }
    await wait(40);

    const gfx = rt.gfx;
    const px = (x: number, y: number) => gfx.buffer[y * W + x];
    const SY = 60;                       // main.scrollY
    const dTop = DRAWER_Y - SY;          // drawer's drawn position
    // Drawer panel painted.
    expect(px(50, dTop + 30)).toBe(DRAWER_BG);
    // Drawer content painted: the title drew glyphs (non-panel pixels in the
    // title's rect) and the buttons drew their own bg.
    const title = rt.nodes.find((n: any) => n.id === "dtitle");
    let titleGlyphPx = 0;
    for (let y = title.box.y; y < title.box.y + title.box.h; y++) {
      for (let x = title.box.x; x < title.box.x + title.box.w; x++) {
        if (px(x, y) !== DRAWER_BG && px(x, y) !== 0) titleGlyphPx++;
      }
    }
    expect(titleGlyphPx).toBeGreaterThan(4);
    expect(px(20, DRAWER_Y - SY + 24)).toBe(0x0f0f); // Tap me button bg
    expect(px(60, DRAWER_Y - SY + 24)).toBe(0x0f0f); // Close button bg

    // Nothing inside the panel is screen-background (an erase to the wrong
    // backdrop), either before or after the echo updates.
    const erasedCount = (): number => {
      let n = 0;
      for (let y = dTop + 2; y < dTop + DRAWER_H - 2; y++) {
        for (let x = 8; x < 92; x++) if (px(x, y) === 0) n++;
      }
      return n;
    };
    { let x0=999,y0=999,x1=-1,y1=-1;
      for (let y = dTop + 2; y < dTop + DRAWER_H - 2; y++) for (let x = 8; x < 92; x++) if (px(x,y)===0){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;}
      console.log('PRE-TAP erase bbox:', x0, y0, x1, y1, 'n=', erasedCount()); }
    console.log('PRE-TAP erasedCount:', erasedCount());
    const baseline = erasedCount();  // small top-edge strip from the slide clear
    expect(baseline).toBeLessThan(200);

    // Tap "Tap me" → taps++ → echo (behind the drawer) rebinds.
    rt.runBody("taps = 1");
    await wait(60);
    for (let i = 0; i < 6; i++) { rt.tick(33); }
    await wait(40);

    expect(erasedCount()).toBe(baseline);  // unchanged by the tap
    expect(px(20, DRAWER_Y - SY + 24)).toBe(0x0f0f);
    expect(px(60, DRAWER_Y - SY + 24)).toBe(0x0f0f);
    const echo = rt.nodes.find((n: any) => n.id === "echo");
    expect(String(echo.textBuffer)).toContain("1");
  });
});
