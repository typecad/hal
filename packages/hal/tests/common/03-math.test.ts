import { describe, done } from '@typecad/expect';

describe("Num.map().from().to() chain")
  .it("scales the midpoint of a range")
  .expect(
    (() => {
      return Num.map(512).from(0, 1023).to(0, 255);
    })
  ).toBe(127)
  .it("maps the low endpoint")
  .expect(
    (() => {
      return Num.map(0).from(0, 1023).to(0, 255);
    })
  ).toBe(0)
  .it("maps the high endpoint")
  .expect(
    (() => {
      return Num.map(1023).from(0, 1023).to(0, 255);
    })
  ).toBe(255)

describe("Num.map().from().toPercent()")
  .it("maps the midpoint to 50")
  .expect(
    (() => {
      return Num.map(512).from(0, 1024).toPercent();
    })
  ).toBe(50)
  .it("maps the low endpoint to 0")
  .expect(
    (() => {
      return Num.map(0).from(0, 1024).toPercent();
    })
  ).toBe(0)
  .it("maps the high endpoint to 100")
  .expect(
    (() => {
      return Num.map(1024).from(0, 1024).toPercent();
    })
  ).toBe(100)

describe("Num.map().from().toByte()")
  .it("maps the full range to 255")
  .expect(
    (() => {
      return Num.map(100).from(0, 100).toByte();
    })
  ).toBe(255)
  .it("maps the low endpoint to 0")
  .expect(
    (() => {
      return Num.map(0).from(0, 100).toByte();
    })
  ).toBe(0)

describe("Num.constrain().between()")
  .it("clamps above the range")
  .expect(
    (() => {
      return Num.constrain(200).between(0, 100);
    })
  ).toBe(100)
  .it("clamps below the range")
  .expect(
    (() => {
      return Num.constrain(-5).between(0, 100);
    })
  ).toBe(0)
  .it("passes through an in-range value")
  .expect(
    (() => {
      return Num.constrain(50).between(0, 100);
    })
  ).toBe(50)

describe("Num static helpers")
  .it("Num.abs() of a negative value")
  .expect(
    (() => {
      return Num.abs(-7);
    })
  ).toBe(7)
  .it("Num.min() picks the smaller")
  .expect(
    (() => {
      return Num.min(3, 8);
    })
  ).toBe(3)
  .it("Num.max() picks the larger")
  .expect(
    (() => {
      return Num.max(3, 8);
    })
  ).toBe(8)

describe("Free math functions")
  .it("abs() of a negative value")
  .expect(
    (() => {
      return abs(-42);
    })
  ).toBe(42)
  .it("min() picks the smaller")
  .expect(
    (() => {
      return min(4, 9);
    })
  ).toBe(4)
  .it("max() picks the larger")
  .expect(
    (() => {
      return max(4, 9);
    })
  ).toBe(9)

done();
