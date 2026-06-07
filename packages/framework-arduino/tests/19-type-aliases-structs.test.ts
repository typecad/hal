import { describe, done } from '@typecad/expect';

type Point = { x: number; y: number };

describe("Type alias structs")
  .it("object type alias field access")
  .expect(
    (() => {
      const p: Point = { x: 3, y: 7 };
      return p.x + p.y;
    })
  ).toBe(10)
  .it("type alias struct modification")
  .expect(
    (() => {
      const p: Point = { x: 1, y: 2 };
      const q: Point = { x: p.x + 2, y: p.y + 3 };
      return q.x + q.y;
    })
  ).toBe(8)
  .it("multiple type alias structs")
  .expect(
    (() => {
      const p1: Point = { x: 1, y: 2 };
      const p2: Point = { x: 3, y: 4 };
      return p1.x + p1.y + p2.x + p2.y;
    })
  ).toBe(10)
  .it("type alias field arithmetic")
  .expect(
    (() => {
      const p: Point = { x: 5, y: 12 };
      return p.x * p.x + p.y * p.y;
    })
  ).toBe(169)

done();
