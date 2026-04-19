import { describe, done } from '@typecode/expect';

describe("Arithmetic operators")
  .it("division and modulo")
  .expect((() => 10 % 3)).toBe(1)
  .expect((() => 7 % 2)).toBe(1)
  .it("unary negation")
  .expect(
    (() => {
      const a = 1;
      return -a;
    })
  ).toBe(-1)
  .expect(
    (() => {
      const negative = -42;
      return -negative;
    })
  ).toBe(42)
  .it("order of operations")
  .expect((() => 2 + 3 * 4)).toBe(14)
  .it("parenthesized expressions")
  .expect((() => (2 + 3) * 4)).toBe(20)
  .expect((() => 2 * (3 + 4))).toBe(14)
  .expect((() => (1 + 2) * (3 + 4))).toBe(21)

describe("Number literals")
  .it("hex literal")
  .expect((() => { const hex = 0xFF; return hex; })).toBe(255)
  .it("binary literal")
  .expect((() => { const binary = 0b1010; return binary; })).toBe(10)
  .it("octal literal")
  .expect((() => { const octal = 0o77; return octal; })).toBe(63)
  .it("negative literal")
  .expect((() => { const negative = -42; return negative; })).toBe(-42)
  .it("floating point literal")
  .expect(
    (() => {
      const floating = 3.14;
      return floating;
    })
  ).toBeCloseTo(3.14, 1)

describe("Compound assignment")
  .it("+=, -=, *=, /=")
  .expect(
    (() => {
      let mut = 10;
      return mut;
    })
  ).toBe(10)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      return mut;
    })
  ).toBe(15)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      return mut;
    })
  ).toBe(12)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      mut *= 2;
      return mut;
    })
  ).toBe(24)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      mut *= 2;
      mut /= 4;
      return mut;
    })
  ).toBe(6)

done();
