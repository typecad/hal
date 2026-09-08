import { describe, done } from '@typecad/hal/testing';
// Math suite, adapted to the lowered surface: the emitted Num shim carries
// abs/min/max (Num.map did not survive the rework), and Math.min/max/round
// fold at transpile time.
import { Num } from '@typecad/hal';

describe("Num.abs")
  .it("Num.abs() of a negative value is positive")
  .expect(
    (() => {
      return Num.abs(-5);
    })
  ).toBe(5)
  .it("Num.abs() of a positive value is unchanged")
  .expect(
    (() => {
      return Num.abs(7);
    })
  ).toBe(7)

describe("Num.min / Num.max")
  .it("Num.min() picks the smaller operand")
  .expect(
    (() => {
      return Num.min(3, 7);
    })
  ).toBe(3)
  .it("Num.max() picks the larger operand")
  .expect(
    (() => {
      return Num.max(3, 7);
    })
  ).toBe(7)
  .it("Num.min() with equal operands returns the shared value")
  .expect(
    (() => {
      return Num.min(4, 4);
    })
  ).toBe(4)

describe("Math namespace folding")
  .it("Math.min() folds correctly")
  .expect(
    (() => {
      return Math.min(10, 20);
    })
  ).toBe(10)
  .it("Math.max() folds correctly")
  .expect(
    (() => {
      return Math.max(10, 20);
    })
  ).toBe(20)
  .it("Math.round() rounds half away from zero")
  .expect(
    (() => {
      return Math.round(2.5) * 2;
    })
  ).toBe(6)

done();
