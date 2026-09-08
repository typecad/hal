// The preview ui facade must cover the device's ui.* surface: callbacks like
// `ui.window.setTitle(...)` (lowered to ui_window_set_title on SDL targets)
// previously crashed with "Cannot read properties of undefined (reading
// 'setTitle')".
import { describe, it, expect, afterAll } from "vitest";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeSnapshot(callbackBody: string): any {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 100,
      height: 100,
      colorFormat: "rgb565",
      nodes: [
        {
          index: 0, tag: "screen", classes: [], kind: "fill",
          box: { x: 0, y: 0, w: 100, h: 100 }, bg: 0, fg: 0xffff,
          hasBg: true, textBuffer: "", hasTextBinding: false,
          textAlign: 0, textSize: 1, lineHeight: 8, fontAntialias: false,
          fontFace: 0, letterSpacing: 0, borderColor: 0, borderStyle: 0,
          borderWidth: 0, borderRadius: 0, gradientEnabled: 0,
          gradientColor1: 0, gradientColor2: 0, outlineColor: 0,
          outlineStyle: 0, outlineWidth: 0, zIndex: 0, transformOffsetX: 0,
          transformOffsetY: 0, rotateDeg: 0, pressedOffsetX: 0, pressedOffsetY: 0,
          shadowCount: 0, shadowOffsetX: [], shadowOffsetY: [], shadowBlur: [],
          shadowColor: [], shadowAlpha: [], shadowInset: [],
          textShadowCount: 0, textShadowOffsetX: 0, textShadowOffsetY: 0,
          textShadowBlur: 0, textShadowColor: 0, textShadowAlpha: 0,
          underline: false, nowrap: false, whiteSpaceMode: 0, visible: true,
          opacity: 100, clearColor: 0, lastTextWidth: 0, lastTextHeight: 0,
          dirty: false, value: 0, scrollable: false, scrollY: 0,
          contentHeight: 0, overscrollPx: 0, settling: false,
          lastPaintedScrollY: 0, imgDataId: 255, objectFit: 1,
          rangeMin: 0, rangeMax: 100, maxlen: 0, parentIndex: -1, subtreeEnd: 2,
        },
        {
          index: 1, tag: "button", classes: [], kind: "button",
          box: { x: 10, y: 40, w: 80, h: 30 }, bg: 0, fg: 0xffff,
          text: "tap me", hasBg: false, textBuffer: "", hasTextBinding: false,
          textAlign: 0, textSize: 1, lineHeight: 8, fontAntialias: false,
          fontFace: 0, letterSpacing: 0, borderColor: 0, borderStyle: 0,
          borderWidth: 0, borderRadius: 0, gradientEnabled: 0,
          gradientColor1: 0, gradientColor2: 0, outlineColor: 0,
          outlineStyle: 0, outlineWidth: 0, zIndex: 0, transformOffsetX: 0,
          transformOffsetY: 0, rotateDeg: 0, pressedOffsetX: 0, pressedOffsetY: 0,
          shadowCount: 0, shadowOffsetX: [], shadowOffsetY: [], shadowBlur: [],
          shadowColor: [], shadowAlpha: [], shadowInset: [],
          textShadowCount: 0, textShadowOffsetX: 0, textShadowOffsetY: 0,
          textShadowBlur: 0, textShadowColor: 0, textShadowAlpha: 0,
          underline: false, nowrap: false, whiteSpaceMode: 0, visible: true,
          opacity: 100, clearColor: 0, lastTextWidth: 0, lastTextHeight: 0,
          dirty: false, value: 0, scrollable: false, scrollY: 0,
          contentHeight: 0, overscrollPx: 0, settling: false,
          lastPaintedScrollY: 0, imgDataId: 255, objectFit: 1,
          rangeMin: 0, rangeMax: 100, maxlen: 0, parentIndex: 0, subtreeEnd: 2,
        },
      ],
      transitions: [],
    },
    font: new Uint8Array(0),
    bindings: [],
    listBindings: [],
    callbacks: [{ nodeId: "b", nodeIndex: 1, kind: "click", body: callbackBody }],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    diagnostics: [],
  } as any;
}

describe("preview wheel scroll", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("applies wheel deltas to the scroll owner under the point", async () => {
    const rt = new PreviewUIRuntime(makeSnapshot(
      `ui.window.setTitle("x");`,
    ), {});
    runtimes.push(rt);
    rt.start();
    const list = (rt as any).nodes[1];
    list.scrollable = true;
    list.virtualized = true;
    list.contentHeight = 880;  // 40 items x 22px in a 100x100 viewport
    // Wheel down over the list center: scrollY increases; clamped at max.
    rt.wheel(50, 50, 60);
    expect(list.scrollY).toBe(60);
    rt.wheel(50, 50, 60);
    expect(list.scrollY).toBe(120);
    // Massive delta clamps to maxScroll (880 content - 30-high viewport).
    rt.wheel(50, 50, 100000);
    expect(list.scrollY).toBe(850);
    // Wheel over empty non-scroll space does nothing (no owner).
    const before = list.scrollY;
    rt.wheel(5, 5, 60);
    expect(list.scrollY).toBe(before);
  });
});

describe("preview ui facade", () => {
  const runtimes: PreviewUIRuntime[] = [];
  const prevDocument = (globalThis as { document?: unknown }).document;
  afterAll(() => {
    for (const r of runtimes) r.stop();
    (globalThis as { document?: unknown }).document = prevDocument;
  });

  it("runs ui.window.setTitle callbacks without failing, updating the tab title", async () => {
    const fakeDoc = { title: "TypeCAD Preview" };
    (globalThis as { document?: unknown }).document = fakeDoc;
    const diags: string[] = [];
    // The signal-based demo body (`count.set(...); ui.window.setTitle(...)`)
    // needs the snapshot's script-mined signals; the literal form here covers
    // the regression under test — the facade member existing at all.
    const rt = new PreviewUIRuntime(makeSnapshot(
      `ui.window.setTitle("taps: 3");`,
    ), { onDiagnostics: (m) => diags.push(m) });
    runtimes.push(rt);
    rt.start();
    rt.pointerDown(50, 55);
    rt.pointerUp();
    await wait(60);
    expect(diags.filter((d) => d.includes("Preview callback failed"))).toEqual([]);
    expect(fakeDoc.title).toBe("taps: 3");
  });
});
