import { describe, it, expect, beforeEach } from "vitest";
import { emitCanvasBindings } from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";

describe("emitCanvasBindings", () => {
  it("emits an empty table when there are no specs", () => {
    const out = emitCanvasBindings([]);
    expect(out).toContain("UICanvasBinding __ui_canvas_bindings[] = {};");
    expect(out).toContain("__ui_canvas_binding_count = 0;");
  });

  it("emits a wrapper function per spec + the binding table", () => {
    const out = emitCanvasBindings([
      { nodeIndex: 3, fnName: "__ui_canvas_draw_0", callbackBody: "ui_display_fill_rect(0,0,10,10,0xf800);" },
    ]);
    expect(out).toContain("void __ui_canvas_draw_0(CuttlefishCanvas16* __c) {");
    expect(out).toContain("int16_t __ui_canvas_w = display_canvasWidth(__c);");
    expect(out).toContain("ui_display_fill_rect(0,0,10,10,0xf800);");
    expect(out).toContain("UICanvasBinding __ui_canvas_bindings[] = {");
    expect(out).toContain("{ .node=3, .fn=__ui_canvas_draw_0 },");
    expect(out).toContain("__ui_canvas_binding_count = 1;");
  });
});
