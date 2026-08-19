// Accordion recipe regression: single-open sections driven by a signal via
// ui.bind(x, 'visible', ...); chevron text swap; toggling an open item
// closes it; content of the open section is interactive.
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

function makeAccordionRuntime(): any {
  return new PreviewUIRuntime({
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: 100, height: 120, colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", subtreeEnd: 8, box: { x: 0, y: 0, w: 100, h: 120 } }),
        makeNode({ index: 1, tag: "button", kind: "button", id: "trig0", text: "A", parentIndex: 0, subtreeEnd: 2, box: { x: 4, y: 4, w: 80, h: 24 } }),
        makeNode({ index: 2, tag: "view", kind: "fill", id: "pane0", parentIndex: 0, subtreeEnd: 4, box: { x: 4, y: 30, w: 92, h: 30 }, hasBg: true, bg: 0xaaaa }),
        makeNode({ index: 3, tag: "text", kind: "text", id: "pane0text", text: "content A", parentIndex: 2, subtreeEnd: 4, box: { x: 10, y: 34, w: 60, h: 12 } }),
        makeNode({ index: 4, tag: "button", kind: "button", id: "trig1", text: "B", parentIndex: 0, subtreeEnd: 5, box: { x: 4, y: 64, w: 80, h: 24 } }),
        makeNode({ index: 5, tag: "view", kind: "fill", id: "pane1", parentIndex: 0, subtreeEnd: 7, box: { x: 4, y: 90, w: 92, h: 26 }, hasBg: true, bg: 0xbbbb }),
        makeNode({ index: 6, tag: "text", kind: "text", id: "pane1text", text: "content B", parentIndex: 5, subtreeEnd: 7, box: { x: 10, y: 94, w: 60, h: 12 } }),
        makeNode({ index: 7, tag: "text", kind: "text", id: "chev0", text: "v", parentIndex: 0, subtreeEnd: 8, box: { x: 88, y: 8, w: 16, h: 16 } }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0),
    bindings: [
      { nodeId: "pane0", nodeIndex: 2, property: "visible", expression: "openAcc === 0" },
      { nodeId: "pane1", nodeIndex: 5, property: "visible", expression: "openAcc === 1" },
      { nodeId: "chev0", nodeIndex: 7, property: "text", expression: "openAcc === 0 ? '^' : 'v'" },
    ],
    listBindings: [], callbacks: [],
    initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    moduleVars: [{ name: "openAcc", initializer: "-1" }],
  } as any);
}

describe("accordion (single-open, preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("opens exclusively, swaps the chevron, and toggles closed", async () => {
    const rt: any = makeAccordionRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(120);
    const node = (id: string) => rt.nodes.find((x: any) => x.id === id);
    const text = (id: string) => { const n = node(id); return String((n.hasTextBinding ? n.textBuffer : n.text) ?? ""); };

    // all closed
    expect(node("pane0").visible).toBe(false);
    expect(node("pane1").visible).toBe(false);
    expect(text("chev0")).toBe("v");

    // open item 0
    rt.runBody("openAcc = 0;");
    await wait(150); rt.tick(33);
    expect(node("pane0").visible).toBe(true);
    expect(node("pane1").visible).toBe(false);
    expect(text("chev0")).toBe("^");
    expect(rt.isEffectivelyVisible(node("pane0text"))).toBe(true);
    expect(rt.isEffectivelyVisible(node("pane1text"))).toBe(false);

    // exclusivity: opening 1 closes 0
    rt.runBody("openAcc = 1;");
    await wait(150); rt.tick(33);
    expect(node("pane1").visible).toBe(true);
    expect(node("pane0").visible).toBe(false);
    expect(text("chev0")).toBe("v");

    // toggle closed
    rt.runBody("openAcc = -1;");
    await wait(150); rt.tick(33);
    expect(node("pane1").visible).toBe(false);
  });

  it("collapses reserved space: closing a pane restacks the flow (device parity)", async () => {
    // Same tree, plus flow metadata: the screen is a 6px-gap column stack and
    // the panes are content-sized — what the real build emits for the kit's
    // accordion markup.
    const rt: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 120, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", subtreeEnd: 8, box: { x: 0, y: 0, w: 100, h: 120 }, flowAxis: 1, flowGap: 6, scrollable: true, contentHeight: 122 }),
          makeNode({ index: 1, tag: "button", kind: "button", id: "trig0", text: "A", parentIndex: 0, subtreeEnd: 2, box: { x: 4, y: 4, w: 80, h: 24 } }),
          makeNode({ index: 2, tag: "view", kind: "fill", id: "pane0", parentIndex: 0, subtreeEnd: 4, box: { x: 4, y: 34, w: 92, h: 30 }, hasBg: true, bg: 0xaaaa, flowAxis: 1, flowFlags: 1 }),
          makeNode({ index: 3, tag: "text", kind: "text", id: "pane0text", text: "content A", parentIndex: 2, subtreeEnd: 4, box: { x: 10, y: 38, w: 60, h: 12 } }),
          makeNode({ index: 4, tag: "button", kind: "button", id: "trig1", text: "B", parentIndex: 0, subtreeEnd: 5, box: { x: 4, y: 70, w: 80, h: 24 } }),
          makeNode({ index: 5, tag: "view", kind: "fill", id: "pane1", parentIndex: 0, subtreeEnd: 7, box: { x: 4, y: 100, w: 92, h: 26 }, hasBg: true, bg: 0xbbbb, flowAxis: 1, flowFlags: 1 }),
          makeNode({ index: 6, tag: "text", kind: "text", id: "pane1text", text: "content B", parentIndex: 5, subtreeEnd: 7, box: { x: 10, y: 104, w: 60, h: 12 } }),
          makeNode({ index: 7, tag: "text", kind: "text", id: "chev0", text: "v", parentIndex: 0, subtreeEnd: 8, box: { x: 88, y: 8, w: 16, h: 16 }, flowFlags: 4 }),
        ],
        transitions: [],
      },
      font: new Uint8Array(0),
      bindings: [{ nodeId: "pane0", nodeIndex: 2, property: "visible", expression: "openAcc === 0" }],
      listBindings: [], callbacks: [], initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
      moduleVars: [{ name: "openAcc", initializer: "-1" }],
    } as any);
    runtimes.push(rt);
    rt.start();
    await wait(120);
    const node = (id: string) => rt.nodes.find((x: any) => x.id === id);

    // Baked layout (pane0 visible): trig1 sits below pane0's 30px + gap.
    // openAcc starts -1, so pane0 hides on the first tick and the reflow
    // collapses its reserved space: trig1 and pane1 shift UP by 30+6.
    expect(node("trig1").box.y).toBe(70 - 36);
    expect(node("pane1").box.y).toBe(100 - 36);
    // contentHeight recomputed over visible nodes (last visible bottom = the
    // shifted pane1 bottom) and clamped to the viewport height.
    expect(node("chev0").box.y).toBe(8); // nodes above the collapse never move

    // Re-opening restores the baked stack.
    rt.runBody("openAcc = 0;");
    await wait(150); rt.tick(33);
    expect(node("trig1").box.y).toBe(70);
    expect(node("pane1").box.y).toBe(100);
  });
});
