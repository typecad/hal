import { describe, done } from '@typecad/expect';

describe("Nested functions")
  .it("nested function declaration and call")
  .expect(
    (() => {
      function compute(x: number): number {
        function square(n: number): number {
          return n * n;
        }
        return square(x) + square(x + 1);
      }
      return compute(3);
    })
  ).toBe(25)
  .it("nested helper with multiple calls")
  .expect(
    (() => {
      function addThree(a: number, b: number, c: number): number {
        function add(x: number, y: number): number {
          return x + y;
        }
        return add(add(a, b), c);
      }
      return addThree(10, 20, 30);
    })
  ).toBe(60)
  .it("multiple nested functions")
  .expect(
    (() => {
      function process(value: number): number {
        function double(n: number): number {
          return n * 2;
        }
        function halve(n: number): number {
          return n / 2;
        }
        return double(halve(value));
      }
      return process(10);
    })
  ).toBe(10)

done();
