// <dialog> + <toast>: centered modal + transient notification, built on the
// drawer slot machinery (side "center" = 4, travel 0; duration drives the
// auto-close). Covers parse → lower (side/duration fields), the device
// runtime's emitted guards/timer, and the preview runtime's open/close/
// auto-dismiss behavior.
import { describe, it, expect, afterAll } from "vitest";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { lowerUIToModel } from "@typecad/ui/ui-engine/model";
import { selectEngine } from "../../../packages/ui/src/ui-engine/select-engine";
import { emitRuntimeHeader } from "@typecad/ui/runtime-header";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";
import { GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";

const header = emitRuntimeHeader();

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
    flowAxis: 0, flowGap: 0, flowFlags: 0, toastDuration: 0, ...o,
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("dialog + toast parse → lower", () => {
  it("dialog lowers drawerSide=4 (center), toast lowers side + duration", () => {
    const styled = resolveStyles(parseHtml(
      '<screen id="s">'
      + '<dialog id="d"><view class="dialog-card"><text>T</text></view></dialog>'
      + '<toast id="t" side="bottom" duration="1800"><text>saved</text></toast>'
      + '</screen>'), []);
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 480, h: 320 }, () => ({ width: 6, height: 8 }));
    const program = lowerUIToModel(styled, boxes, "rgb565", { width: 480, height: 320, colorFormat: "rgb565" } as never);
    const dialog = program.nodes.find((n: any) => n.drawerSide === 4);
    expect(dialog).toBeDefined();
    expect(dialog.id).toBe("d");
    expect(dialog.toastDuration).toBe(0);
    const toast = program.nodes.find((n: any) => (n as any).toastDuration === 1800);
    expect(toast).toBeDefined();
    expect(toast.id).toBe("t");
    expect(toast.drawerSide).toBe(0); // bottom
    expect(toast.kind).toBe("fill");
  });

  it("dialog is centered (no slide travel): parse + lowered side", () => {
    const styled = resolveStyles(parseHtml('<screen id="s"><dialog id="d"></dialog></screen>'), []);
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 480, h: 320 }, () => ({ width: 6, height: 8 }));
    const program = lowerUIToModel(styled, boxes, "rgb565", { width: 480, height: 320, colorFormat: "rgb565" } as never);
    expect(program.nodes.find((n: any) => n.id === "d")!.drawerSide).toBe(4);
  });
});

describe("device runtime emission", () => {
  it("centered panels gate on closed state (offsets can't hide them)", () => {
    expect(header).toContain("__ui_nodes[nodeIdx].drawerSide == 4");
    expect(header).toMatch(/centerSlot < 0 \|\| \(!__ui_drawer_open\[centerSlot\]/);
  });

  it("drawer travel is 0 for side 4; toasts auto-close on the tick", () => {
    expect(header).toContain("if (d->drawerSide == 4) travel = 0");
    expect(header).toContain("__ui_toast_elapsed");
    expect(header).toMatch(/toastDuration > 0 && __ui_drawer_open\[s\] &&/);
  });
});

describe("preview runtime behavior", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  function makeOverlayRuntime(): any {
    return new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 60, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", subtreeEnd: 5, box: { x: 0, y: 0, w: 100, h: 60 } }),
          makeNode({ index: 1, tag: "button", kind: "button", id: "btn", text: "B", parentIndex: 0, subtreeEnd: 2, box: { x: 4, y: 4, w: 40, h: 16 } }),
          makeNode({ index: 2, tag: "dialog", id: "dlg", parentIndex: 0, subtreeEnd: 4, box: { x: 20, y: 15, w: 60, h: 30 }, hasBg: true, bg: 0xaaaa, zIndex: 30, drawerSide: 4 }),
          makeNode({ index: 3, tag: "view", kind: "fill", id: "scrim", parentIndex: 2, subtreeEnd: 4, box: { x: 0, y: 0, w: 100, h: 60 }, zIndex: 30 }),
          makeNode({ index: 4, tag: "toast", id: "tst", parentIndex: 0, subtreeEnd: 5, box: { x: 10, y: 40, w: 80, h: 16 }, hasBg: true, bg: 0x0f0f, zIndex: 40, drawerSide: 0, toastDuration: 300 }),
        ],
        transitions: [],
      },
      font: new Uint8Array(GLCDFONT_BYTES.slice(0, 1280) as unknown as number[]),
      bindings: [], listBindings: [], callbacks: [], initialAssignments: [],
      intervals: [], pinControls: [], diagnostics: [],
    } as any);
  }

  it("dialog opens and closes through the ui.dialog facade", async () => {
    const rt: any = makeOverlayRuntime();
    runtimes.push(rt);
    rt.start();
    const dlg = rt.nodes.find((n: any) => n.id === "dlg");
    // Hidden while closed (centered gate: no state entry = closed).
    expect(rt.insideClosedDrawer(dlg.index)).toBe(true);
    rt.drawerOpen("dlg");
    for (let i = 0; i < 20; i++) { rt.tick(16); }
    await wait(30);
    expect(rt.insideClosedDrawer(dlg.index)).toBe(false);
    // Centered: no slide offsets were applied.
    expect(dlg.transformOffsetX).toBe(0);
    expect(dlg.transformOffsetY).toBe(0);
    const scrim = rt.nodes.find((n: any) => n.id === "scrim");
    rt.drawerClose("dlg");
    expect(rt.insideClosedDrawer(scrim.index)).toBe(false);  // still open at this point
    for (let i = 0; i < 20; i++) { rt.tick(16); }
    await wait(30);
    expect(rt.insideClosedDrawer(dlg.index)).toBe(true);
    expect(rt.insideClosedDrawer(scrim.index)).toBe(true);   // child gated via ancestor
  });

  it("toast auto-closes after its duration", async () => {
    const rt: any = makeOverlayRuntime();
    runtimes.push(rt);
    rt.start();
    const tst = rt.nodes.find((n: any) => n.id === "tst");
    rt.drawerOpen("tst");
    for (let i = 0; i < 12; i++) { rt.tick(16); } // ~192ms: open, still shown
    await wait(20);
    // Edge-drawer roots hide by offsets, not the closed gate — assert the
    // slot state instead (an entry exists while open/animating).
    expect(rt.drawerStates.has(tst.index)).toBe(true);
    for (let i = 0; i < 40; i++) { rt.tick(16); } // ~832ms: close (slide+300ms) + slide-out
    await wait(20);
    // Auto-closed and fully slid out: the slot entry is gone.
    expect(rt.drawerStates.has(tst.index)).toBe(false);
  });
});
