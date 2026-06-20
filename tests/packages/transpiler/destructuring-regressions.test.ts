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
