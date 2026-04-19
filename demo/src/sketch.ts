import { describe, done } from '@typecode/expect';
import { A0, UART0 } from '@typecode';

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
const a = 1;
let b = 2;
let c = 3;
const uint8array = new Uint8Array([0xAA, 0x10, 0x20]);
const int16array = new Int16Array([4, -2, 7]);
const float32array = new Float32Array([1.0, 0.5, 0.25]);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------
function add(a: number, b: number): number {
  return a + b;
}

function clamp(value: number, min: number = 0, max: number = 1023): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Object / destructuring
// ---------------------------------------------------------------------------
const config = {
  low: 150,
  high: 700,
  timeout: undefined,
};

const { low, high, timeout = 500 } = config;

// ---------------------------------------------------------------------------
// Number literals
// ---------------------------------------------------------------------------
const hex = 0xFF;
const binary = 0b1010;
const octal = 0o77;
const negative = -42;
const floating = 3.14;

// ---------------------------------------------------------------------------
// Mutable variables for mutation tests
// ---------------------------------------------------------------------------
let mut = 10;

// ---------------------------------------------------------------------------
// Variables for comparison tests (typed as number to avoid literal-type errors)
// ---------------------------------------------------------------------------
let n1: number = 1;
let n2: number = 2;
let n3: number = 3;
let n5: number = 5;

// ---------------------------------------------------------------------------
// Arrow function
// ---------------------------------------------------------------------------
const square = (x: number): number => x * x;

// ---------------------------------------------------------------------------
// for-of loop
// ---------------------------------------------------------------------------
const scores: ReadonlyArray<number> = [10, 20, 30, 40];

function forOfSum(): number {
  let total = 0;
  for (const value of scores) {
    total += value;
  }
  return total;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe("Basics")
  .it("basic math")
  .expect(a + b).toBe(3)
  .expect(b - a).toBe(1)
  .expect(b * c).toBe(6)
  .it("Variable assignment")
  .expect(a).toBe(1)
  .expect(b).toBe(2)
  .expect(c).toBe(3)
  .it("Functions")
  .expect(add(1, 2)).toBe(3)
  .expect(clamp(2000, 0)).toBe(1023)
  .it("Arrays")
  .expect(uint8array[1]).toBe(0x10)
  .expect(int16array[1]).toBe(-2)
  .expect(float32array[1]).toBe(0.5)
  .expect(config.low).toBe(150)
  .expect(low).toBe(150)
  .expect(timeout).toBe(500)

describe("Arithmetic operators")
  .it("division and modulo")
  .expect(10 % 3).toBe(1)
  .expect(7 % 2).toBe(1)
  .it("unary negation")
  .expect(-a).toBe(-1)
  .expect(-negative).toBe(42)
  .it("order of operations")
  .expect(2 + 3 * 4).toBe(14)
  .it("parenthesized expressions (Bug 7)")
  .expect((2 + 3) * 4).toBe(20)
  .expect(2 * (3 + 4)).toBe(14)
  .expect((1 + 2) * (3 + 4)).toBe(21)

describe("Number literals")
  .it("hex literal")
  .expect(hex).toBe(255)
  .it("binary literal")
  .expect(binary).toBe(10)
  .it("octal literal")
  .expect(octal).toBe(63)
  .it("negative literal")
  .expect(negative).toBe(-42)
  .it("floating point literal")
  .expect(floating).toBeCloseTo(3.14, 1)

describe("Compound assignment")
  .it("+=, -=, *=, /=")
  .expect(mut).toBe(10)
  .expect(mut += 5).toBe(15)
  .expect(mut -= 3).toBe(12)
  .expect(mut *= 2).toBe(24)
  .expect(mut /= 4).toBe(6)

describe("Comparison via ternary")
  .it("equality and inequality")
  .expect(n5 === n5 ? 1 : 0).toBe(1)
  .expect(n5 === n3 ? 1 : 0).toBe(0)
  .expect(n5 !== n3 ? 1 : 0).toBe(1)
  .it("less than / greater than")
  .expect(n3 < n5 ? 1 : 0).toBe(1)
  .expect(n5 > n3 ? 1 : 0).toBe(1)
  .expect(n5 < n3 ? 1 : 0).toBe(0)
  .it("less or equal / greater or equal")
  .expect(n5 <= n5 ? 1 : 0).toBe(1)
  .expect(n3 <= n5 ? 1 : 0).toBe(1)
  .expect(n5 >= n5 ? 1 : 0).toBe(1)
  .expect(n5 >= n3 ? 1 : 0).toBe(1)

describe("Logical operators via numeric patterns")
  .it("logical AND")
  .expect(n1 === n1 && n2 === n2 ? 1 : 0).toBe(1)
  .expect(n1 === n1 && n2 === n3 ? 1 : 0).toBe(0)
  .it("logical OR")
  .expect(n1 === n1 || n2 === n3 ? 1 : 0).toBe(1)
  .expect(n1 === n3 || n2 === n3 ? 1 : 0).toBe(0)
  .it("logical NOT")
  .expect(n1 !== n3 ? 1 : 0).toBe(1)
  .expect(n1 !== n1 ? 1 : 0).toBe(0)

describe("Bitwise operators")
  .it("AND, OR, XOR")
  .expect(0xFF & 0x0F).toBe(0x0F)
  .expect(0xF0 | 0x0F).toBe(0xFF)
  .expect(0xFF ^ 0x0F).toBe(0xF0)
  .it("shifts and NOT")
  .expect(1 << 4).toBe(16)
  .expect(256 >> 4).toBe(16)
  .expect(~0).toBe(-1)

describe("Ternary expressions")
  .it("simple ternary")
  .expect(n1 === n1 ? 1 : 0).toBe(1)
  .expect(n1 === n3 ? 1 : 0).toBe(0)
  .it("nested ternary")
  .expect(n5 > 10 ? 1 : n5 > n3 ? 2 : 3).toBe(2)

describe("Arrow function")
  .it("arrow function call")
  .expect(square(4)).toBe(16)
  .expect(square(7)).toBe(49)

describe("For-of loop")
  .it("for-of accumulation")
  .expect(forOfSum()).toBe(100)

function const_let(): number {
  const fixed = 10;
  let mutable_ = 5;
  mutable_ = fixed + mutable_; // this is a transpilation bug, 'let mutable_' is emitted on the above line, but 'mutable_' is not used
  return mutable_;
}

function test_block_scoping(): number {
  let x = 1;
  {
    let x = 2; // C++ must handle this as a separate stack variable
  }
  return x;
}

// Section 1: Variables and Scoping
describe("Variables and Scoping")
  .it("const and let assignment")
    .expect(const_let()).toBe(15)

  .it("block scoping shadowing")
    .expect(test_block_scoping()).toBe(1)
done();
