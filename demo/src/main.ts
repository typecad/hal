// ---------------------------------------------------------------------------
// main.ts — destructuring & pattern-binding stress test (cuttlefish, Arduino AVR)
//
// No end-state goal. A maximal showcase hammering the destructuring surface
// (SUPPORT_MATRIX §1.9) — all claimed ✅ — to find where the claim breaks.
// Covers: object/array/nested destructuring, rest element, defaults, swap,
// destructuring of class fields, destructuring of generic-type values,
// for...of over a destructured element, and parameter destructuring
// (object/array/nested/mixed). The likely failure axis is REST elements,
// which the matrix claims lower to `std::vector<T>` slices — but AVR has no
// std::vector (TS2CPP_NO_VECTOR_STORAGE), so rest-on-AVR is the prime suspect.
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board-arduino-uno';

// ── Records / structs to destructure ───────────────────────────────────────
interface Point {
  x: int32_t;
  y: int32_t;
}

interface Rect2 {
  origin: Point;
  w: int32_t;
  h: int32_t;
}

// A class with fields, to destructure an instance.
class Sample {
  value: int32_t;
  label: string;
  constructor(value: int32_t, label: string) {
    this.value = value;
    this.label = label;
  }
}

// ── 1. Object destructuring (flat) ─────────────────────────────────────────
function destructureObject(): void {
  const p: Point = { x: 3, y: 4 };
  const { x, y }: Point = p;
  console.log('obj ' + x + ',' + y);
}

// ── 2. Nested object destructuring ─────────────────────────────────────────
function destructureNestedObject(): void {
  const r: Rect2 = { origin: { x: 1, y: 2 }, w: 10, h: 20 };
  const { origin: { x, y }, w }: Rect2 = r;
  console.log('nest ' + x + ',' + y + ',' + w);
}

// ── 3. Array destructuring ─────────────────────────────────────────────────
function destructureArray(): void {
  const arr: int32_t[] = [10, 20, 30];
  const [a, b, c]: int32_t[] = arr;
  console.log('arr ' + a + ',' + b + ',' + c);
}

// ── 4. Array destructuring with default ────────────────────────────────────
function destructureArrayDefault(): void {
  const arr: int32_t[] = [5];
  const [first, second = 99]: int32_t[] = arr;
  console.log('arrdef ' + first + ',' + second);
}

// ── 5. Array destructuring with rest element ───────────────────────────────
// STRESS-NOTE: `const [head, ...tail] = arr` lowers `tail` to std::vector and
// fails on AVR ('vector' is not a member of 'std'). SUPPORT_MATRIX §1.9 marks
// "Rest element" ✅ but says it lowers to "std::vector<T> slice" — which is
// native-only; AVR has no std::vector. The head binds fine; only the rest
// element needs a vector. Worked around to a fixed-index extraction; the gap
// is notated.
function destructureArrayRest(): void {
  const arr: int32_t[] = [1, 2, 3, 4, 5];
  const head: int32_t = arr[0];
  console.log('rest ' + head);
}

// ── 6. Object destructuring with rename ────────────────────────────────────
function destructureRename(): void {
  const p: Point = { x: 7, y: 8 };
  const { x: px, y: py }: Point = p;
  console.log('rename ' + px + ',' + py);
}

// ── 7. Swap via array destructuring ────────────────────────────────────────
function swap(): void {
  let a: int32_t = 1;
  let b: int32_t = 2;
  [a, b] = [b, a];
  console.log('swap ' + a + ',' + b);
}

// ── 8. Destructure a class instance (fields) ───────────────────────────────
function destructureClass(): void {
  const s: Sample = new Sample(42, 'hi');
  const { value, label }: Sample = s;
  console.log('cls ' + value + ' ' + label);
}

// ── 9. Parameter destructuring (object) ────────────────────────────────────
function translate({ x, y }: Point): int32_t {
  return x + y;
}

// ── 10. Parameter destructuring (nested object) ────────────────────────────
function area({ origin: { x, y }, w, h }: Rect2): int32_t {
  return x + y + w + h;
}

// ── 11. Parameter destructuring (array) ────────────────────────────────────
// STRESS-NOTE: `function sumFirst([a, b]: int32_t[])` fails on AVR with
// TS2CPP_NO_VECTOR_STORAGE — an array-typed PARAMETER lowers to
// std::vector<int32_t> (no compile-time size recoverable from a param), and
// AVR has no std::vector. SUPPORT_MATRIX §5.10 marks "Array destructure param"
// ✅ but that's native-only; on AVR it's unsupported. Object/array-LITERAL
// destructuring (§1.9) works because the literal has a recoverable size; a
// bare array param does not. Worked around below; the gap is notated.
function sumFirst(): int32_t {
  const arr: int32_t[] = [10, 20];
  const [a, b]: int32_t[] = arr;
  return a + b;
}

// ── 12. Mixed destructure + regular params ─────────────────────────────────
function mixed({ x }: Point, scale: int32_t): int32_t {
  return x * scale;
}

// ── 13. Destructure a generic-typed value ──────────────────────────────────
class Box<T> {
  v: T;
  constructor(v: T) { this.v = v; }
}
function destructureGeneric(): void {
  const b: Box<int32_t> = new Box<int32_t>(77);
  const { v }: Box<int32_t> = b;
  console.log('gen ' + v);
}

// ── 14. for...of over a destructured element ───────────────────────────────
// STRESS-NOTE (two bugs here):
// (a) `for (const { x, y } of pts)` CRASHES the transpiler (TypeError: Cannot
//     read properties of undefined (reading 'kind')). control-flow.ts:283-298
//     calls forInitializerToIR, which reads declaration.name.text assuming an
//     identifier — for a binding pattern the name is undefined, so the
//     var_decl has name:undefined and the body's references to x/y are never
//     bound. Not in SUPPORT_MATRIX §1.9.
// (b) The `const pts: Point[] = [...]` itself is a separate bug (Finding D):
//     a struct-element array literal lowers to std::vector<P> on AVR with NO
//     diagnostic, producing non-compiling C++. (Primitive arrays lower to a
//     C array correctly.)
// Worked around with a fixed-size primitive array + manual indexing.
function forOfDestructure(): void {
  const xs: int32_t[] = [1, 3];
  const ys: int32_t[] = [2, 4];
  let total: int32_t = 0;
  for (let i: int32_t = 0; i < 2; i = i + 1) {
    total = total + xs[i] + ys[i];
  }
  console.log('forof ' + total);
}

// ── Driver ─────────────────────────────────────────────────────────────────
const led = LED.asOutput();

function main(): void {
  console.log('--- destructuring stress test ---');
  destructureObject();
  destructureNestedObject();
  destructureArray();
  destructureArrayDefault();
  destructureArrayRest();
  destructureRename();
  swap();
  destructureClass();
  destructureGeneric();
  forOfDestructure();

  console.log('trans ' + translate({ x: 5, y: 6 }));
  console.log('area ' + area({ origin: { x: 1, y: 2 }, w: 3, h: 4 }));
  console.log('sum ' + sumFirst());
  console.log('mixed ' + mixed({ x: 4, y: 0 }, 10));

  led.high();
  console.log('done');
}

main();
