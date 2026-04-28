import { describe, done } from '@typehal/expect';

describe("Function completeness")
  .it("default parameter value")
  .expect(
    (() => {
      function scale(value: number, factor: number = 2): number {
        return value * factor;
      }
      return scale(21);
    })
  ).toBe(42)
  .it("nested helper calls")
  .expect(
    (() => {
      function twice(value: number): number {
        return value * 2;
      }
      function plusOne(value: number): number {
        return value + 1;
      }
      return plusOne(twice(20));
    })
  ).toBe(41)
  .it("function expression assignment")
  .expect(
    (() => {
      const adjust = function(value: number): number {
        return value - 2;
      };
      return adjust(44);
    })
  ).toBe(42)

describe("Collection lowering")
  .it("typed array indexing")
  .expect(
    (() => {
      const readings = new Uint16Array([100, 200, 300]);
      return readings[2];
    })
  ).toBe(300)
  .it("readonly array iteration")
  .expect(
    (() => {
      const values: ReadonlyArray<number> = [3, 4, 5];
      let total = 0;
      for (const value of values) {
        total += value;
      }
      return total;
    })
  ).toBe(12)

describe("Destructuring defaults")
  .it("object default initializer")
  .expect(
    (() => {
      const settings = { timeout: undefined, retries: 2 };
      const { timeout = 1000 } = settings;
      return timeout;
    })
  ).toBe(1000)

done();
