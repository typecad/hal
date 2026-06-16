// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #11 (Atlas).
//
// Fixes covered:
//   E — try/catch now emits catch(...) (catch-all) so thrown non-exception
//       types are caught (was catch(const std::exception&), which missed
//       thrown pointers/values of user types).
//   Namespace — gated out via TSModuleDeclaration lint selector.
//
// Documented (not yet fixed) — see README:
//   A — object spread { ...a, b } doesn't lower (no C++ aggregate equivalent)
//   B — keyof T / indexed access type T[K] dropped at emit
//   D — array-of-objects literals create shadow-struct collisions
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// E: try/catch emits catch(...) (catch-all)
// ---------------------------------------------------------------------------
describe("E: try/catch catch-all", () => {
  it("catch (e) emits catch (...) not catch (const std::exception& e)", () => {
    const result = transpileNativeSplit(
      [
        "export function f(): int32_t {",
        "  try { return 1; }",
        "  catch (e) { return -1; }",
        "  finally {}",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("catch (...)");
    expect(cpp).not.toContain("std::exception");
  });
});

// ---------------------------------------------------------------------------
// D: array-of-objects with a named element type uses the named type (no shadow struct)
// ---------------------------------------------------------------------------
describe("D: array-of-objects named element type", () => {
  it("const pts: Point[] = [{x:1,y:2}] uses Point, not _pts_t", () => {
    const result = transpileNativeSplit(
      [
        "export interface Point { x: int32_t; y: int32_t; }",
        "export function f(): int32_t {",
        "  const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];",
        "  return pts[0]!.x;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // Must use std::vector<Point>, NOT a shadow struct _pts_t.
    expect(cpp).toContain("std::vector<Point>");
    expect(cpp).not.toContain("_pts_t");
  });
});
