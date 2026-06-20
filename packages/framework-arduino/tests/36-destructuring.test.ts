import { describe, done } from '@typecad/expect';

// ---------------------------------------------------------------------------
// Destructuring & pattern binding — expect tests for the patterns fixed in the
// destructuring stress test (Findings A, B, D). These transpile, compile, and
// run on real AVR hardware via `cuttlefish-test`, asserting runtime values.
//
// Uses named interfaces (the idiomatic, well-supported form) rather than
// anonymous inline object types, so the element arrays lower cleanly to
// __tc_StaticArray<Name,N> without the anonymous-object shadow-struct path.
//
// Coverage:
//   • object / nested-object / array / array-default / rename destructuring
//   • swap via array destructuring
//   • rest element from a LITERAL (works on AVR; size recoverable)
//   • for...of with a destructured loop variable (Finding A fix)
//   • for...of with an array-element destructure
//   • struct-element array literal (Finding D fix → __tc_StaticArray)
//
// NOTE: rest-from-VARIABLE and array-typed PARAMETER destructuring are
// AVR-🚫 (no recoverable size → std::vector → TS2CPP_NO_VECTOR_STORAGE) and
// are NOT tested here — they are covered by the unit diagnostics in
// tests/packages/transpiler/destructuring-regressions.test.ts.
// ---------------------------------------------------------------------------

interface Point { x: number; y: number }
interface Rect { origin: Point; w: number; h: number }

describe("Object destructuring")
  .it("flat object destructure")
  .expect(
    (() => {
      const p: Point = { x: 3, y: 4 };
      const { x, y } = p;
      return x + y;
    })
  ).toBe(7)
  .it("nested object destructure")
  .expect(
    (() => {
      const r: Rect = { origin: { x: 1, y: 2 }, w: 10, h: 20 };
      const { origin: { x, y }, w } = r;
      return x + y + w;
    })
  ).toBe(13)
  .it("object destructure with rename")
  .expect(
    (() => {
      const p: Point = { x: 7, y: 8 };
      const { x: px, y: py } = p;
      return px * 10 + py;
    })
  ).toBe(78)

describe("Array destructuring")
  .it("flat array destructure")
  .expect(
    (() => {
      const arr: number[] = [10, 20, 30];
      const [a, b, c] = arr;
      return a + b + c;
    })
  ).toBe(60)
  .it("array destructure with default")
  .expect(
    (() => {
      const arr: number[] = [5];
      const [first, second = 99] = arr;
      return first + second;
    })
  ).toBe(104)
  .it("swap via array destructuring")
  .expect(
    (() => {
      let a: number = 1;
      let b: number = 2;
      [a, b] = [b, a];
      return a * 10 + b;
    })
  ).toBe(21)

describe("Rest element from a literal (AVR-supported)")
  .it("rest element splits head and tail length")
  .expect(
    (() => {
      const [head, ...tail]: number[] = [1, 2, 3, 4, 5];
      // head is 1; tail is the remaining 4 elements. Use the tail length so
      // the assertion doesn't depend on tail's exact storage shape.
      return head + tail.length;
    })
  ).toBe(5)

describe("Class-field destructuring")
  .it("destructure a class instance's fields")
  .expect(
    (() => {
      class Sample {
        value: number;
        constructor(value: number) {
          this.value = value;
        }
      }
      const s = new Sample(42);
      const { value } = s;
      return value;
    })
  ).toBe(42)

// ── Finding A: for...of with a destructured loop variable ──────────────────
// The array-element destructure variant (for (const [a, b] of pairs)) requires
// number[][] (array-of-arrays), which is a separate type-resolution case
// (the inner number[] mis-resolves); it's covered by the unit test in
// destructuring-regressions.test.ts. The hardware test covers the object-field
// destructure, the common case.
describe("for...of with a destructured loop variable (Finding A)")
  .it("sums destructured object fields across iterations")
  .expect(
    (() => {
      const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
      let total = 0;
      for (const { x, y } of pts) {
        total += x + y;
      }
      return total;
    })
  ).toBe(21)

// ── Finding D: struct-element array literal → __tc_StaticArray on AVR ──────
describe("Struct-element array literal (Finding D)")
  .it("builds and indexes an array of structs")
  .expect(
    (() => {
      const pts: Point[] = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
      return pts[0].x + pts[1].y;
    })
  ).toBe(50)
  .it("iterates a struct-element array via for...of")
  .expect(
    (() => {
      const pts: Point[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
      let total = 0;
      for (const p of pts) {
        total += p.x;
      }
      return total;
    })
  ).toBe(6)

// Combine the two fixed features: for...of + destructure over a struct array.
describe("for...of + destructure over a struct-element array (A + D)")
  .it("sums fields across a struct array")
  .expect(
    (() => {
      const pts: Point[] = [{ x: 2, y: 3 }, { x: 4, y: 5 }];
      let total = 0;
      for (const { x, y } of pts) {
        total += x * y;
      }
      return total;
    })
  ).toBe(26)

done();
