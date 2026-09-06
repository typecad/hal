// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #12 (Cipher).
//
// Fixes covered:
//   E — .sort(comparator) now produces correct ascending order (the TS
//       convention negative=before is converted to std::sort's true=before).
//
// Documented (not yet fixed) — see README:
//   A — forEach on runtime vectors (callback ISR can't capture locals)
//   B — in-class sort forward-decl ordering (move to free function)
//   C — export default function (inline FunctionExpression not processed)
//   D — top-level Float32Array (extern float* vs float[] mismatch)
//   F — NonNullable<T> value + snprintf %d (format spec doesn't resolve alias)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// E: .sort(comparator) uses the TS convention (negative = before)
// ---------------------------------------------------------------------------
describe("E: sort comparator convention", () => {
  it("__tc_sort_fn wraps the comparator to convert TS convention to std::sort", () => {
    const result = transpileNativeSplit(
      [
        "export function sortAsc(data: int32_t[]): int32_t[] {",
        "  const copy: int32_t[] = [];",
        "  for (const v of data) { copy.push(v); }",
        "  copy.sort((a: int32_t, b: int32_t) => a - b);",
        "  return copy;",
        "}",
        "const _log1 = sortAsc([5, 3, 1])[0];",
        "",
      ].join("\n"),
    );
    const header = result.header ?? "";
    // The polyfill must convert the comparator convention (comp(a,b) < 0).
    expect(header).toMatch(/comp\(a,\s*b\)\s*<\s*0/);
  });
});
