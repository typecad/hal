import { describe, done } from '@typecad/expect';

describe("Callback patterns")
  .it("function passed to helper")
  .expect(
    (() => {
      function multiply(a: number, b: number): number {
        return a * b;
      }
      return multiply(7, 3);
    })
  ).toBe(21)
  .it("function returning function result")
  .expect(
    (() => {
      function addTen(val: number): number {
        return val + 10;
      }
      return addTen(5);
    })
  ).toBe(15)
  .it("callback via arrow in map")
  .expect(
    (() => {
      const values = [1, 2, 3, 4];
      const doubled = values.map((v: number) => v * 2);
      return doubled[2];
    })
  ).toBe(6)
  .it("chained function calls")
  .expect(
    (() => {
      function square(n: number): number {
        return n * n;
      }
      function negate(n: number): number {
        return -n;
      }
      return negate(square(6));
    })
  ).toBe(-36)

done();
