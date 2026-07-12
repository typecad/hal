import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetUIRegistry, loadUIModule, clearEntryHasUI } from "../../../packages/ui/src/ui-engine/ui-registry";
import {
  tryResolveUICall,
  resetUICallState,
  registerUIModuleImport,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { canvasBindings, resetCanvasBindings } from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) fs.rmSync(d, { recursive: true, force: true });
  resetUIRegistry();
  resetUICallState();
  resetCanvasBindings();
  clearEntryHasUI();
});

function firstCallExpr(stmt: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", stmt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); };
  visit(file);
  return calls[0];
}

describe("ui.drawCanvas resolver", () => {
  let diagnostics: Diagnostic[];
  beforeEach(() => { resetUICallState(); resetCanvasBindings(); diagnostics = []; });

  it("records a DrawCanvasSpec with the resolved node index + lowered body", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-resolver-"));
    tempDirs.push(dir);
    const htmlPath = path.join(dir, "app.ui.html");
    fs.writeFileSync(htmlPath, `<screen><canvas id="spark" width="60" height="30"></canvas></screen>`, "utf-8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf-8");
    loadUIModule(htmlPath);
    registerUIModuleImport("screen", htmlPath);

    const call = firstCallExpr(`ui.drawCanvas(screen.spark, (ctx) => { ctx.fillRect(0,0,10,10,'red'); });`);
    const ir = tryResolveUICall(call, "x.ts", "", diagnostics);

    expect(ir).not.toBeNull();
    expect(canvasBindings()).toHaveLength(1);
    const spec = canvasBindings()[0];
    expect(spec.nodeIndex).toBe(1); // spark is the only child of <screen>; the
                                     // screen root occupies index 0, so spark = 1
    expect(spec.fnName).toMatch(/__ui_canvas_draw_/);
    expect(spec.callbackBody).toContain("ui_display_fill_rect(0, 0, 10, 10, 0xf800)");
  });

  it("ignores ui.drawCanvas calls whose first arg is not screen.X", () => {
    const call = firstCallExpr(`ui.drawCanvas(unknownThing, (ctx) => {});`);
    const ir = tryResolveUICall(call, "x.ts", "", diagnostics);
    expect(ir).toBeNull();
  });
});
