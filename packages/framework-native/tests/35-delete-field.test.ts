import { describe, done } from '@typecad/expect';

describe("Delete on struct fields")
  .it("delete returns true")
  .expect(
    (() => {
      const obj = { val: 10 };
      const result = delete obj.val;
      if (result) return 1;
      return 0;
    })
  ).toBe(1)
  .it("delete resets field to default")
  .expect(
    (() => {
      const obj = { x: 42 };
      const r = delete obj.x;
      return obj.x;
    })
  ).toBe(0)
  .it("non-deleted field unchanged")
  .expect(
    (() => {
      const obj = { x: 10, y: 20 };
      const r = delete obj.x;
      return obj.y;
    })
  ).toBe(20)

done();
