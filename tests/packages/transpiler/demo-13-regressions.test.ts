// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #13 (KitchenSink).
//
// Fixes covered:
//   C — ||= and &&= on property-access left sides now lowered
//   D/E/F/B — gated out (conditional types, mapped types, ReturnType/Parameters,
//             static initializer blocks) via lint selectors
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// C: ||= and &&= on property access
// ---------------------------------------------------------------------------
describe("C: ||= and &&= on property access", () => {
  it("obj.flag ||= true lowers to a ternary assignment", () => {
    const result = transpileNativeSplit(
      [
        "export interface O { flag: boolean; }",
        "export function f(o: O): void {",
        "  let local: O = { flag: o.flag };",
        "  local.flag ||= true;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // The ||= must produce a ternary: local.flag = (local.flag ? local.flag : true)
    expect(cpp).toContain("local.flag =");
    expect(cpp).toContain("? local.flag");
  });

  it("obj.val &&= 99 lowers to a ternary assignment", () => {
    const result = transpileNativeSplit(
      [
        "export interface O { val: int32_t; }",
        "export function f(o: O): void {",
        "  let local: O = { val: o.val };",
        "  local.val &&= 99;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // The &&= must produce a ternary: local.val = (local.val ? 99 : local.val)
    expect(cpp).toContain("local.val =");
    expect(cpp).toContain(": local.val");
    expect(cpp).toContain("99");
  });
});
