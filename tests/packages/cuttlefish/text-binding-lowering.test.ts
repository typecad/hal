import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import {
  lowerTextBindingBody,
  resetUICallState,
  recordSignal,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

// Parse a TS arrow body to its Expression AST the way the resolver does.
function bodyOf(arrow: string): ts.Expression {
  const sf = ts.createSourceFile("b.ts", arrow, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) throw new Error("bad arrow");
  const e = stmt.expression;
  if (!ts.isArrowFunction(e) || !ts.isExpression(e.body)) throw new Error("not arrow w/ expr body");
  return e.body as ts.Expression;
}

describe("lowerTextBindingBody", () => {
  let diags: Diagnostic[];

  beforeEach(() => {
    resetUICallState();
    diags = [];
  });

  afterEach(() => {
    resetUICallState();
  });

  it("lowers String(<int signal read>) to snprintf %d", () => {
    recordSignal("count", "int", 0);
    const body = bodyOf("() => String(count())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%d", count)');
    expect(diags).toHaveLength(0);
  });

  it("lowers String(<float signal read>) to snprintf %g", () => {
    recordSignal("ratio", "float", 1.5);
    const body = bodyOf("() => String(ratio())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%g", ratio)');
    expect(diags).toHaveLength(0);
  });

  it("lowers a bare string literal to snprintf %s", () => {
    const body = bodyOf(`() => "idle"`);
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%s", "idle")');
    expect(diags).toHaveLength(0);
  });

  it("lowers a template literal with one numeric interpolation", () => {
    recordSignal("n", "int", 0);
    const body = bodyOf("() => `count: ${n()}`");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "count: %d", n)');
    expect(diags).toHaveLength(0);
  });

  it("falls back to a safe no-op + ui-bind-text-unlowered warning for unknown shapes", () => {
    // An array literal is none of the three shapes.
    const body = bodyOf("() => [1, 2, 3]");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toBe("buf[0] = 0;");
    expect(diags.some((d) => d.code === "ui-bind-text-unlowered")).toBe(true);
  });
});
