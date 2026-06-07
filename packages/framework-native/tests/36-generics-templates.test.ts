import { describe, done } from '@typecad/expect';

describe("Generic templates")
  .it("generic identity function")
  .expect(
    (() => {
      function identity<T>(x: T): T {
        return x;
      }
      return identity(42);
    })
  ).toBe(42)
  .it("generic clamp function")
  .expect(
    (() => {
      function clamp<T>(val: T, lo: T, hi: T): T {
        if (val < lo) return lo;
        if (val > hi) return hi;
        return val;
      }
      return clamp(200, 0, 100);
    })
  ).toBe(100)
  .it("generic min function")
  .expect(
    (() => {
      function min<T>(a: T, b: T): T {
        if (a < b) return a;
        return b;
      }
      return min(30, 10);
    })
  ).toBe(10)
  .it("generic max function")
  .expect(
    (() => {
      function max<T>(a: T, b: T): T {
        if (a > b) return a;
        return b;
      }
      return max(5, 8);
    })
  ).toBe(8)
  .it("generic function with two type params")
  .expect(
    (() => {
      function pickFirst<T, U>(a: T, b: U): T {
        return a;
      }
      return pickFirst(7, 100);
    })
  ).toBe(7)

done();
