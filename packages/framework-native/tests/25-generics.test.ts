import { describe, done } from '@typehal/expect';

describe("Generic-style patterns")
  .it("container class with get")
  .expect(
    (() => {
      class Box {
        value: number;
        constructor(v: number) {
          this.value = v;
        }
        get(): number {
          return this.value;
        }
      }
      const c = new Box(99);
      return c.get();
    })
  ).toBe(99)
  .it("container class with set and get")
  .expect(
    (() => {
      class Holder {
        val: number;
        constructor(v: number) {
          this.val = v;
        }
        get(): number {
          return this.val;
        }
        set(v: number): void {
          this.val = v;
        }
      }
      const h = new Holder(10);
      h.set(20);
      return h.get();
    })
  ).toBe(20)
  .it("generic identity function")
  .expect(
    (() => {
      function identity<T>(value: T): T {
        return value;
      }
      const result = identity(77);
      return result;
    })
  ).toBe(77)
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

done();
