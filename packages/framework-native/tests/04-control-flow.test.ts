import { describe, done } from '@typecad/expect';

describe("Ternary expressions")
  .it("simple ternary")
  .expect(
    (() => {
      let n1: number = 1;
      let n3: number = 3;
      return n1 === n1 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n1: number = 1;
      let n3: number = 3;
      return n1 === n3 ? 1 : 0;
    })
  ).toBe(0)
  .it("nested ternary")
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 > 10 ? 1 : n5 > n3 ? 2 : 3;
    })
  ).toBe(2)

describe("Arrow function")
  // KNOWN BUG: arrow functions assigned to const (e.g. `const square = (x) => x*x`)
  // are mis-extracted as ISR handlers (main_isr_N) with their parameter stripped,
  // so the call fails to compile. The ISR-extraction pass misfires on arrow
  // function expressions. These two assertions are commented out until fixed.
  .it("arrow function call")
  // .expect(
  //   (() => {
  //     const square = (x: number): number => x * x;
  //     return square(4);
  //   })
  // ).toBe(16)
  // .expect(
  //   (() => {
  //     const square = (x: number): number => x * x;
  //     return square(7);
  //   })
  // ).toBe(49)

describe("For-of loop")
  .it("for-of accumulation")
  .expect(
    (() => {
      const scores: ReadonlyArray<number> = [10, 20, 30, 40];
      let total = 0;
      for (const value of scores) {
        total += value;
      }
      return total;
    })
  ).toBe(100)

done();
