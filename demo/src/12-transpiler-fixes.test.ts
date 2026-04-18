import { describe, done } from '@typecode/expect';

// ---------------------------------------------------------------------------
// Feature 8: Property assignments (this.x = value, this.x += n, this.x -= n)
// ---------------------------------------------------------------------------

class Counter {
  count: number = 0;
  increment(n: number): number {
    this.count += n;
    return this.count;
  }
  reset(): number {
    this.count = 0;
    return this.count;
  }
}

class Accumulator {
  total: number = 0;
  add(v: number): number {
    this.total += v;
    return this.total;
  }
  subtract(v: number): number {
    this.total -= v;
    return this.total;
  }
}

const counter = new Counter();
const acc = new Accumulator();

// ---------------------------------------------------------------------------
// Feature 8: Element assignments (arr[i] = value)
// ---------------------------------------------------------------------------

function writeAt(arr: number[], i: number, v: number): number {
  arr[i] = v;
  return arr[i];
}

// ---------------------------------------------------------------------------
// Feature 9: Parenthesized expressions (operator precedence)
// ---------------------------------------------------------------------------

function parensCalc(a: number, b: number): number {
  return (a + b) * 2;
}

function nestedParens(a: number, b: number): number {
  return ((a + b) * (a - b));
}

// ---------------------------------------------------------------------------
// Feature 10: Generic functions (type parameters → C++ template)
// ---------------------------------------------------------------------------

function clamp<T>(v: T, lo: T, hi: T): T {
  if (v < lo) { return lo; }
  if (v > hi) { return hi; }
  return v;
}

function minGeneric<A>(a: A, b: A): A {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// Feature 11: Union types (number | null → number)
// ---------------------------------------------------------------------------

function maybeValue(): number | null {
  return 42;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe("Property assignments")
  .it("this.count += n compound assignment")
    .expect(counter.increment(5)).toBe(5)
    .expect(counter.increment(3)).toBe(8)
  .it("this.count = 0 reset assignment")
    .expect(counter.reset()).toBe(0)
  .it("this.total += and -= mixed assignments")
    .expect(acc.add(20)).toBe(20)
    .expect(acc.add(15)).toBe(35)
    .expect(acc.subtract(5)).toBe(30)

describe("Element assignments")
  .it("arr[i] = value")
    .expect(writeAt([0, 0, 0], 1, 99)).toBe(99)

describe("Parenthesized expressions")
  .it("(a + b) * 2 preserves precedence")
    .expect(parensCalc(3, 4)).toBe(14)
  .it("((a+b)*(a-b)) nested parens")
    .expect(nestedParens(5, 3)).toBe(16)

describe("Generic functions")
  .it("clamp<int> limits value")
    .expect(clamp(15, 0, 10)).toBe(10)
    .expect(clamp(-5, 0, 10)).toBe(0)
    .expect(clamp(5, 0, 10)).toBe(5)
  .it("minGeneric picks smaller")
    .expect(minGeneric(3, 7)).toBe(3)
    .expect(minGeneric(9, 2)).toBe(2)

describe("Union types")
  .it("number | null returning value")
    .expect(maybeValue()!).toBe(42)

done();