// ---------------------------------------------------------------------------
// ui-signal-initializer diagnostic tests
//
// Guards the fix for the silent-miscompilation blocker: previously, when
// ui.signal() was called with an initial value other than a numeric, string,
// or boolean literal, resolveSignalCall() silently fell through to `int = 0`
// with no diagnostic. These tests assert it now emits a `ui-signal-initializer`
// WARNING for unsupported initializers, and remains silent for the three
// supported shapes.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import {
  resetUIRegistry,
  clearEntryHasUI,
} from "@typecad/cuttlefish/ui/ui-registry";
import {
  tryResolveUICall,
  resetUICallState,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

afterEach(() => {
  resetUIRegistry();
  resetUICallState();
  clearEntryHasUI();
});

/** Parse a statement and return the first CallExpression it contains. */
function firstCallExpr(stmt: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", stmt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (calls.length === 0) throw new Error("no call expression in: " + stmt);
  return calls[0];
}

describe("ui-signal-initializer diagnostic", () => {
  let diagnostics: Diagnostic[];

  beforeEach(() => {
    resetUIRegistry();
    resetUICallState();
    clearEntryHasUI();
    diagnostics = [];
  });

  it("emits ui-signal-initializer warning for an object literal", () => {
    const src = "ui.signal({ x: 1 });";
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-signal-initializer");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(diag!.message).toMatch(/signal/i);
  });

  it("emits ui-signal-initializer warning for an array literal", () => {
    const src = "ui.signal([1, 2, 3]);";
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-signal-initializer")).toBe(true);
  });

  it("emits ui-signal-initializer warning for null", () => {
    const src = "ui.signal(null);";
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-signal-initializer")).toBe(true);
  });

  it("does NOT warn for a numeric literal", () => {
    const src = "ui.signal(42);";
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-signal-initializer")).toBe(false);
  });

  it("does NOT warn for a string literal", () => {
    const src = 'ui.signal("hello");';
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-signal-initializer")).toBe(false);
  });

  it("does NOT warn for a boolean literal", () => {
    const src = "ui.signal(true);";
    const call = firstCallExpr(src);
    tryResolveUICall(call, "x.ts", src, diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-signal-initializer")).toBe(false);
  });
});
