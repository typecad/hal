import { describe, done } from '@typecad/expect';

describe("Object utility patterns")
  .it("array of keys from object fields")
  .expect(
    (() => {
      const keys: string[] = ["a", "b", "c"];
      return keys.length;
    })
  ).toBe(3)
  .it("array of values from object fields")
  .expect(
    (() => {
      const obj = { x: 10, y: 20, z: 30 };
      const vals: number[] = [obj.x, obj.y, obj.z];
      let sum = 0;
      for (const v of vals) {
        sum += v;
      }
      return sum;
    })
  ).toBe(60)
  .it("count object fields via array")
  .expect(
    (() => {
      const obj = { a: 1, b: 2 };
      const vals: number[] = [obj.a, obj.b];
      return vals.length;
    })
  ).toBe(2)

done();
