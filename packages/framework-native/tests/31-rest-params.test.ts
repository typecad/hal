import { describe, done } from '@typecad/expect';

describe("Rest parameters")
  .it("function with vector param iterates")
  .expect(
    (() => {
      function sum(nums: number[]): number {
        let total = 0;
        for (const n of nums) {
          total += n;
        }
        return total;
      }
      return sum([1, 2, 3, 4]);
    })
  ).toBe(10)
  .it("function with vector param length")
  .expect(
    (() => {
      function count(items: number[]): number {
        return items.length;
      }
      return count([10, 20, 30]);
    })
  ).toBe(3)
  .it("empty vector passed")
  .expect(
    (() => {
      function count(items: number[]): number {
        return items.length;
      }
      return count([]);
    })
  ).toBe(0)
  .it("vector element access")
  .expect(
    (() => {
      function first(items: number[]): number {
        return items[0];
      }
      return first([42]);
    })
  ).toBe(42)

done();
