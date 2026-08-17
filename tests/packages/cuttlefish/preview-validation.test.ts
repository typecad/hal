// Form validation states regression: a required input swaps its border to the
// destructive color and reveals a .field-error hint while invalid; a non-empty
// value restores the input-token border and shows the success hint.
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

function makeRuntime(): any {
  return new PreviewUIRuntime({
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: 100, height: 120, colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", subtreeEnd: 4, box: { x: 0, y: 0, w: 100, h: 120 } }),
        makeNode({ index: 1, tag: "input", kind: "input", id: "name", placeholder: "required", parentIndex: 0, subtreeEnd: 2, box: { x: 4, y: 4, w: 90, h: 28 }, borderColor: 0x39e8, borderStyle: 1 }),
        makeNode({ index: 2, tag: "text", kind: "text", id: "err", text: "name is required", parentIndex: 0, subtreeEnd: 3, box: { x: 4, y: 36, w: 90, h: 12 } }),
        makeNode({ index: 3, tag: "text", kind: "text", id: "ok", text: "looks good", parentIndex: 0, subtreeEnd: 4, box: { x: 4, y: 36, w: 90, h: 12 } }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0),
    bindings: [
      { nodeId: "name", nodeIndex: 1, property: "borderColor", expression: "invalid ? '#ef4444' : '#3f3f46'" },
      { nodeId: "err", nodeIndex: 2, property: "visible", expression: "invalid" },
      { nodeId: "ok", nodeIndex: 3, property: "visible", expression: "!invalid" },
    ],
    listBindings: [], callbacks: [],
    initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    moduleVars: [{ name: "invalid", initializer: "false" }],
  } as any);
}

describe("form validation states (preview)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("swaps border + hints with the invalid signal", async () => {
    const rt: any = makeRuntime();
    runtimes.push(rt);
    rt.start();
    await wait(120);
    const node = (id: string) => rt.nodes.find((x: any) => x.id === id);
    const input = node("name");
    const defaultBorder = input.borderColor;
    expect(node("err").visible).toBe(false);
    expect(node("ok").visible).toBe(true);

    rt.runBody("invalid = true;");
    await wait(150); rt.tick(33);
    expect(input.borderColor).not.toBe(defaultBorder);
    expect(node("err").visible).toBe(true);
    expect(node("ok").visible).toBe(false);

    rt.runBody("invalid = false;");
    await wait(150); rt.tick(33);
    expect(input.borderColor).toBe(defaultBorder);
    expect(node("err").visible).toBe(false);
    expect(node("ok").visible).toBe(true);
  });
});
