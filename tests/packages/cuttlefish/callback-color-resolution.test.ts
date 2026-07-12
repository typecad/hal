import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import { lowerCallbackExpr } from "../../../packages/cuttlefish/src/ir/transformers/ui-callback-lowering";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { resetDisplayProfile, setDisplayProfile } from "../../../packages/cuttlefish/src/stores/display-profile-store";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

// lowerCallbackExpr resolves CSS color string literals in callback bodies to
// the target's internal int representation (rgb565 here), so an author's
// () => "limegreen" reaches the device as 0x07e0. The resolver regex used to
// match only #rrggbb / #rgb / lowercase names / rgba?(), missing #rrggbbaa,
// hsl()/hsla(), and uppercase/mixed-case names — those fell through and were
// emitted as raw C string literals cast to uint32 (nonsense values). This
// locks down that every format parseColor accepts also resolves here.

function exprOf(src: string): ts.Expression {
  const sf = ts.createSourceFile("c.ts", src, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) throw new Error("bad expr");
  return stmt.expression;
}

describe("lowerCallbackExpr: color-literal resolution coverage", () => {
  let diags: Diagnostic[];

  beforeEach(() => {
    resetUICallState();
    diags = [];
    // Bind an rgb565 display profile so resolveColorInternal targets 565.
    setDisplayProfile({ colorFormat: "rgb565" } as never, {});
  });
  afterEach(() => {
    resetUICallState();
    resetDisplayProfile();
  });

  it("resolves a 6-digit hex color", () => {
    const out = lowerCallbackExpr(exprOf('"#ff0000"'), "", diags);
    expect(out).toBe("0xf800");
  });

  it("resolves an 8-digit hex color (#rrggbbaa)", () => {
    // Previously missed by the regex; parseColor supports it.
    const out = lowerCallbackExpr(exprOf('"#aabbcc11"'), "", diags);
    expect(out).toMatch(/^0x[0-9a-f]+$/i);
    expect(out).not.toContain('"');
  });

  it("resolves an hsl() color", () => {
    // Previously missed by the regex; parseColor supports hsl/hsla.
    const out = lowerCallbackExpr(exprOf('"hsl(120, 100%, 50%)"'), "", diags);
    expect(out).toMatch(/^0x[0-9a-f]+$/i);
    expect(out).not.toContain('"');
  });

  it("resolves an uppercase named color", () => {
    // Previously missed because the regex used [a-z]+ only; parseColor
    // lowercases names so "LIMEGREEN" resolves like "limegreen".
    const lower = lowerCallbackExpr(exprOf('"limegreen"'), "", diags);
    const upper = lowerCallbackExpr(exprOf('"LIMEGREEN"'), "", diags);
    expect(upper).toBe(lower);
    expect(upper).not.toContain('"');
  });

  it("resolves a mixed-case named color", () => {
    const lower = lowerCallbackExpr(exprOf('"limegreen"'), "", diags);
    const mixed = lowerCallbackExpr(exprOf('"LimeGreen"'), "", diags);
    expect(mixed).toBe(lower);
  });
});
