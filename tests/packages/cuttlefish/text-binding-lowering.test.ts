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

  it("escapes literal % in template-literal fragments so snprintf stays well-formed", () => {
    // Mirrors the demo's progress caption: `meter: ${value * 10}%`. Without
    // escaping, the trailing % produces a malformed format string ("meter: %d%")
    // that snprintf on hardware misreads. The HTML {expr} path already escapes;
    // the TS template-literal path must agree.
    recordSignal("pct", "int", 0);
    const body = bodyOf("() => `meter: ${pct()}%`");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('"meter: %d%%"');
    expect(diags).toHaveLength(0);
  });

  it("escapes literal % in the template head, not just trailing spans", () => {
    recordSignal("n", "int", 0);
    const body = bodyOf("() => `${n()}% done`");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('"%d%% done"');
    expect(diags).toHaveLength(0);
  });

  it("lowers String(<string signal read>) to snprintf %s", () => {
    // A const char* signal interpolated via String(...) must use %s, not %d
    // (which would be UB on hardware — %d against a char*). Mirrors the runtime
    // type table from variables.ts.
    recordSignal("msg", "const char*", "");
    const body = bodyOf("() => String(msg())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%s", msg)');
    expect(diags).toHaveLength(0);
  });

  it("lowers a template literal with a string-signal interpolation to %s", () => {
    recordSignal("name", "const char*", "");
    const body = bodyOf("() => `hello ${name()}`");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('"hello %s"');
    expect(out.cppBody).toContain(", name)");
    expect(diags).toHaveLength(0);
  });

  it("lowers String(<bool signal read>) to snprintf %d (hardware prints 1/0)", () => {
    // Booleans lower to %d on hardware (prints 1/0); the preview must agree by
    // stringifying true/false as "1"/"0" (covered in preview-bind-input-style
    // tests). This asserts the runtime side emits %d for a bool signal.
    recordSignal("on", "bool", false);
    const body = bodyOf("() => String(on())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%d", on)');
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
