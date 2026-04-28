import { describe, done } from '@typehal/expect';

describe("Math functions")
  .it("Math.round")
  .expect(
    (() => {
      return Math.round(3.7);
    })
  ).toBe(4)
  .expect(
    (() => {
      return Math.round(3.2);
    })
  ).toBe(3)
  .expect(
    (() => {
      return Math.round(3.5);
    })
  ).toBe(4)
  .it("Math.floor")
  .expect(
    (() => {
      return Math.floor(3.9);
    })
  ).toBe(3)
  .expect(
    (() => {
      return Math.floor(-1.1);
    })
  ).toBe(-2)
  .it("Math.ceil")
  .expect(
    (() => {
      return Math.ceil(3.1);
    })
  ).toBe(4)
  .expect(
    (() => {
      return Math.ceil(-1.9);
    })
  ).toBe(-1)
  .it("Math.abs")
  .expect(
    (() => {
      return Math.abs(-42);
    })
  ).toBe(42)
  .expect(
    (() => {
      return Math.abs(42);
    })
  ).toBe(42)
  .it("Math.pow")
  .expect(
    (() => {
      return Math.pow(2, 8);
    })
  ).toBe(256)
  .expect(
    (() => {
      return Math.pow(10, 3);
    })
  ).toBe(1000)
  .it("Math.sqrt")
  .expect(
    (() => {
      return Math.sqrt(144);
    })
  ).toBe(12)
  .expect(
    (() => {
      return Math.sqrt(256);
    })
  ).toBe(16)

done();
