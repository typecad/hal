import { describe, done } from '@typecad/expect';


describe("Array basics")
  .it("array literal and element access")
  .expect(
    (() => {
      const arr = [10, 20, 30];
      return arr[0];
    })
  ).toBe(10)
  .expect(
    (() => {
      const arr = [10, 20, 30];
      return arr[2];
    })
  ).toBe(30)
  .it("array length property")
  .expect(
    (() => {
      const arr = [10, 20, 30, 40];
      return arr.length;
    })
  ).toBe(4)
  .it("array mutation via index")
  .expect(
    (() => {
      const arr = [10, 20, 30];
      arr[1] = 99;
      return arr[1];
    })
  ).toBe(99)

describe("Array push and pop")
  .it("push adds element and returns new length")
  .expect(
    (() => {
      const arr = [1, 2, 3];
      const newLength = arr.push(4);
      return newLength;
    })
  ).toBe(4)
  .expect(
    (() => {
      const arr = [1, 2, 3];
      arr.push(4);
      return arr[3];
    })
  ).toBe(4)
  .it("pop removes and returns last element")
  .expect(
    (() => {
      const arr = [10, 20, 30];
      const last = arr.pop();
      return last as number;
    })
  ).toBe(30)
  .expect(
    (() => {
      const arr = [10, 20, 30];
      arr.pop();
      return arr.length;
    })
  ).toBe(2)

describe("Array indexOf and includes")
  .it("indexOf finds element")
  .expect(
    (() => {
      const arr = [10, 20, 30];
      return arr.indexOf(20);
    })
  ).toBe(1)
  .it("indexOf returns -1 when not found")
  .expect(
    (() => {
      const arr = [10, 20, 30];
      return arr.indexOf(99);
    })
  ).toBe(-1)

describe("Array spread")
  .it("spread into new array")
  .expect(
    (() => {
      const a = [1, 2];
      const b = [...a, 3, 4];
      return b.length;
    })
  ).toBe(4)
  .expect(
    (() => {
      const a = [1, 2];
      const b = [...a, 3, 4];
      return b[2];
    })
  ).toBe(3)

describe("ReadonlyArray")
  .it("readonly array iteration")
  .expect(
    (() => {
      const data: ReadonlyArray<number> = [5, 10, 15];
      let sum = 0;
      for (const v of data) {
        sum += v;
      }
      return sum;
    })
  ).toBe(30)

describe("Array map")
  .it("map transforms elements")
  .expect(
    (() => {
      const arr = [1, 2, 3];
      const doubled = arr.map((x: number): number => x * 2);
      return doubled[1];
    })
  ).toBe(4)
  .expect(
    (() => {
      const arr = [1, 2, 3];
      const doubled = arr.map((x: number): number => x * 2);
      return doubled.length;
    })
  ).toBe(3)

describe("Array filter")
  .it("filter selects elements")
  .expect(
    (() => {
      const arr = [1, 2, 3, 4, 5];
      const evens = arr.filter((x: number): boolean => x % 2 === 0);
      return evens.length;
    })
  ).toBe(2)
  .expect(
    (() => {
      const arr = [1, 2, 3, 4, 5];
      const evens = arr.filter((x: number): boolean => x % 2 === 0);
      return evens[0];
    })
  ).toBe(2)

describe("Array reduce")
  .it("reduce sums elements")
  .expect(
    (() => {
      const arr = [1, 2, 3, 4];
      const sum = arr.reduce((acc: number, val: number): number => acc + val, 0);
      return sum;
    })
  ).toBe(10)



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
done();
