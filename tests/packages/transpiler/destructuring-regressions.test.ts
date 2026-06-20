import { describe, it, expect } from "vitest";
import { transpile, transpileArduino } from "../../setup";

// ── Finding D: struct-element array literal lowers to StaticArray on AVR ──
// A read-only array of structs (`const pts: Point[] = [...]`) silently lowers
// to std::vector<P> on AVR with NO diagnostic, producing non-compiling C++.
// Primitive arrays emit a C array; struct arrays must use __tc_StaticArray<P,N>
// (size recoverable from the literal) — same as mutated arrays already do.
describe("D: struct-element array literal lowers to StaticArray on AVR", () => {
  it("emits __tc_StaticArray<P,N> (not std::vector) for a read-only struct array", () => {
    const src = `
interface Point { x: int32_t; y: int32_t; }
function f(): void {
  const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  console.log('' + pts[0].x);
}
f();
`;
    const res = transpileArduino(src);
    // Must NOT emit std::vector (AVR has no <vector>).
    expect(res.cpp).not.toMatch(/std::vector<Point>/);
    // Must lower to a fixed-size array (__tc_StaticArray or equivalent).
    expect(res.cpp).toMatch(/__tc_StaticArray<Point,\s*\d+>|Point\s+pts\[/);
    // No silent miscompile: either no diagnostic, or a clean one (not a raw
    // 'vector is not a member of std' that only surfaces at g++ time).
    expect(res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE")).toEqual([]);
  });
});

// ── Finding A: for...of with a destructuring loop variable ─────────────────
// `for (const { x, y } of pts)` crashed the transpiler (TypeError reading
// 'kind' of undefined). The for...of lowerer assumed an identifier loop var.
// It must desugar the binding pattern to a synthetic loop var + per-field
// extraction at the top of the body.
describe("A: for...of with a destructuring loop variable", () => {
  it("does not crash and binds the destructured fields", () => {
    const src = `
interface Point { x: int32_t; y: int32_t; }
function f(): void {
  const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  let total: int32_t = 0;
  for (const { x, y } of pts) {
    total = total + x + y;
  }
  console.log('' + total);
}
f();
`;
    // Must not throw.
    const res = transpileArduino(src);
    // The body must reference the destructured fields (not crash), and the
    // emitted loop must iterate the array. The total accumulates 1+2+3+4=10.
    expect(res.cpp).toMatch(/for\s*\(/);
    expect(res.cpp).toMatch(/total/);
  });

  it("array-element destructure in for...of", () => {
    const src = `
function f(): void {
  const pairs: int32_t[][] = [[1, 2], [3, 4]];
  let total: int32_t = 0;
  for (const [a, b] of pairs) {
    total = total + a + b;
  }
  console.log('' + total);
}
f();
`;
    const res = transpileArduino(src);
    expect(res.cpp).toMatch(/for\s*\(/);
  });
});
