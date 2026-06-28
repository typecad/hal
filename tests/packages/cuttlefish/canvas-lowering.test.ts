import { describe, it, expect, beforeEach } from "vitest";
import ts from "typescript";
import {
  rewriteCanvasCall,
  resetCanvasBindings,
  canvasBindings,
} from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";

function callExpr(code: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (calls.length === 0) throw new Error("no call in: " + code);
  return calls[0];
}

describe("canvas ctx lowering", () => {
  beforeEach(() => resetCanvasBindings());

  it("rewrites ctx.fillRect(x,y,w,h,'red') to ui_display_fill_rect with resolved color", () => {
    const out = rewriteCanvasCall(callExpr("ctx.fillRect(1, 2, 3, 4, 'red')"), "ctx", []);
    // 'red' = #ff0000 = rgb565 0xf800
    expect(out).toBe("ui_display_fill_rect(1, 2, 3, 4, 0xf800);");
  });

  it("rewrites ctx.line(...) to ui_display_draw_line", () => {
    const out = rewriteCanvasCall(callExpr("ctx.line(0, 0, 10, 10, 'limegreen')"), "ctx", []);
    // 'limegreen' = #32CD32 → rgb565 0x3666 (NOT pure green 0x07e0)
    expect(out).toBe("ui_display_draw_line(0, 0, 10, 10, 0x3666);");
  });

  it("rewrites ctx.width / ctx.height inside args to __ui_canvas_w / __ui_canvas_h", () => {
    const out = rewriteCanvasCall(callExpr("ctx.line(0, ctx.height, ctx.width, ctx.height, 'red')"), "ctx", []);
    expect(out).toBe("ui_display_draw_line(0, __ui_canvas_h, __ui_canvas_w, __ui_canvas_h, 0xf800);");
  });

  it("rewrites ctx.text(x,y,str,color) to set_cursor + set_text_color_solid + print", () => {
    const out = rewriteCanvasCall(callExpr("ctx.text(4, 12, `50%`, 'white')"), "ctx", []);
    // Template literal lowers to a C++ string literal.
    expect(out).toContain("ui_display_set_cursor(4, 12);");
    expect(out).toContain("ui_display_set_text_color_solid(0xffff);");
    expect(out).toContain("ui_display_print(");
  });

  it("returns null (with a diagnostic) for an unknown ctx method", () => {
    const diags: any[] = [];
    const out = rewriteCanvasCall(callExpr("ctx.bogus(1)"), "ctx", diags);
    expect(out).toBeNull();
    expect(diags.some((d) => d.code === "ui-canvas-method")).toBe(true);
  });

  it("returns null for a call that is not on ctx", () => {
    const out = rewriteCanvasCall(callExpr("foo(1)"), "ctx", []);
    expect(out).toBeNull();
  });
});
