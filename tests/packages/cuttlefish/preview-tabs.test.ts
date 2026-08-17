// Tabs recipe regression: signal-driven pane switching via ui.bind(x,
// 'visible', ...) on absolutely-stacked panes; trigger styling swaps literal
// colors; pane content stays interactive while its pane is shown.
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

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeTabsRuntime(): any {
  return new PreviewUIRuntime({
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: 100, height: 120, colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", subtreeEnd: 7, box: { x: 0, y: 0, w: 100, h: 120 } }),
        makeNode({ index: 1, tag: "button", kind: "button", id: "tab0", text: "A", parentIndex: 0, subtreeEnd: 2, box: { x: 4, y: 4, w: 44, h: 28 } }),
        makeNode({ index: 2, tag: "button", kind: "button", id: "tab1", text: "B", parentIndex: 0, subtreeEnd: 3, box: { x: 52, y: 4, w: 44, h: 28 } }),
        makeNode({ index: 3, tag: "view", kind: "fill", id: "pane0", parentIndex: 0, subtreeEnd: 5, box: { x: 4, y: 36, w: 92, h: 70 }, hasBg: true, bg: 0xaaaa }),
        makeNode({ index: 4, tag: "text", kind: "text", id: "pane0text", text: "content A", parentIndex: 3, subtreeEnd: 5, box: { x: 10, y: 42, w: 60, h: 12 } }),
        makeNode({ index: 5, tag: "view", kind: "fill", id: "pane1", parentIndex: 0, subtreeEnd: 7, box: { x: 4, y: 36, w: 92, h: 70 }, hasBg: true, bg: 0xbbbb }),
        makeNode({ index: 6, tag: "text", kind: "text", id: "pane1text", text: "content B", parentIndex: 5, subtreeEnd: 7, box: { x: 10, y: 42, w: 60, h: 12 } }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0), bindings: [
      { nodeId: "pane0", nodeIndex: 3, property: "visible", expression: "activeTab === 0" },
      { nodeId: "pane1", nodeIndex: 5, property: "visible", expression: "activeTab === 1" },
      { nodeId: "tab0", nodeIndex: 1, property: "background", expression: "activeTab === 0 ? '#18181b' : '#09090b'" },
      { nodeId: "tab1", nodeIndex: 2, property: "background", expression: "activeTab === 1 ? '#18181b' : '#09090b'" },
    ], listBindings: [], callbacks: [],
    initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    moduleVars: [
      { name: "activeTab", initializer: "0" },
    ],
  } as any);
}

describe("tabs (signal-driven panes, preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("switches pane visibility and trigger styling from the signal", async () => {
    const rt: any = makeTabsRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(80);
    await wait(150); rt.tick(33);
    const pane0 = rt.nodes.find((n: any) => n.id === "pane0");
    const pane1 = rt.nodes.find((n: any) => n.id === "pane1");
    const tab0 = rt.nodes.find((n: any) => n.id === "tab0");
    const tab1 = rt.nodes.find((n: any) => n.id === "tab1");
    expect(pane0.visible).toBe(true);
    expect(pane1.visible).toBe(false);
    expect((tab0.bg ?? 0).toString(16)).not.toBe((tab1.bg ?? 0).toString(16));
    // switch
    rt.runBody("activeTab = 1;");
    await wait(150); rt.tick(33);
    expect(pane1.visible).toBe(true);
    expect(pane0.visible).toBe(false);
    expect((tab1.bg ?? 0).toString(16)).not.toBe((tab0.bg ?? 0).toString(16));
    // content of the visible pane is hittable; hidden pane's is not
    const p1text = rt.nodes.find((n: any) => n.id === "pane1text");
    const p0text = rt.nodes.find((n: any) => n.id === "pane0text");
    expect(rt.isEffectivelyVisible(p1text)).toBe(true);
    expect(rt.isEffectivelyVisible(p0text)).toBe(false);
    // and back
    rt.runBody("activeTab = 0;");
    await wait(150); rt.tick(33);
    expect(pane0.visible).toBe(true);
    expect(pane1.visible).toBe(false);
  });
});
