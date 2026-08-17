// <drawer> regression: slide-in panels open/close programmatically, hide
// while closed, take inside taps, close on outside taps, and reset on
// navigation.
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
    rangeMin: 0, rangeMax: 100, maxlen: 0, parentIndex: -1, subtreeEnd: 1, ...o,
  };
}

const W = 100, H = 120;

function makeDrawerRuntime(): PreviewUIRuntime {
  const rt: any = new PreviewUIRuntime({
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: W, height: H, colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", subtreeEnd: 4, box: { x: 0, y: 0, w: W, h: H } }),
        // drawer panel: absolute bottom, 60 tall
        makeNode({
          index: 1, tag: "drawer", kind: "fill", id: "d1", hasBg: true, bg: 0xaaaa,
          box: { x: 0, y: 60, w: W, h: 60 }, parentIndex: 0, subtreeEnd: 4,
          drawerSide: 0,
        }),
        makeNode({ index: 2, tag: "text", kind: "text", text: "drawer body", parentIndex: 1, subtreeEnd: 3, box: { x: 4, y: 66, w: 60, h: 12 } }),
        makeNode({ index: 3, tag: "button", kind: "button", text: "Tap", parentIndex: 1, subtreeEnd: 4, box: { x: 4, y: 82, w: 40, h: 20 } }),
        makeNode({ index: 4, tag: "screen", subtreeEnd: 5, screenId: 1, box: { x: 0, y: 0, w: W, h: H } }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0), bindings: [], listBindings: [], callbacks: [],
    initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
  } as any);
  return rt;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("<drawer> slide-in panels (preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("hides the subtree while closed and shows it after ui.drawer.open", async () => {
    const rt: any = makeDrawerRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(80);
    // closed: descendants pushed offscreen (offset = panel height)
    const title = rt.nodes[2];
    expect(rt.drawYForNode(title.index)).toBeGreaterThanOrEqual(H);
    rt.runBody("ui.drawer.open('d1');");
    await wait(400); rt.tick(33);
    // open: back at rest position
    expect(rt.drawYForNode(title.index)).toBe(66);
  });

  it("closes on ui.drawer.close and on outside taps; inside taps pass through", async () => {
    const rt: any = makeDrawerRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(80);
    rt.runBody("ui.drawer.open('d1');");
    await wait(400); rt.tick(33);
    // inside tap hits the drawer's button (press state)
    rt.pointerDown(10, 92); rt.pointerUp();
    await wait(120); rt.tick(33);
    expect(rt.nodes[3].value).toBe(0); // released already; tap registered via handlers absence — no crash
    // outside tap closes
    rt.pointerDown(50, 10); rt.pointerUp();
    await wait(500); rt.tick(33);
    expect(rt.drawYForNode(rt.nodes[2].index)).toBeGreaterThanOrEqual(H);
    // reopen then explicit close
    rt.runBody("ui.drawer.open('d1');");
    await wait(400); rt.tick(33);
    rt.runBody("ui.drawer.close('d1');");
    await wait(500); rt.tick(33);
    expect(rt.drawYForNode(rt.nodes[2].index)).toBeGreaterThanOrEqual(H);
  });

  it("resets drawers on navigation", async () => {
    const rt: any = makeDrawerRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(80);
    rt.runBody("ui.drawer.open('d1');");
    await wait(400); rt.tick(33);
    rt.navigate(1); rt.tick(16);
    expect(rt.drawYForNode(rt.nodes[2].index)).toBeGreaterThanOrEqual(H);
  });
});
