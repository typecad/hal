import { describe, done } from '@typecad/expect';

interface Point {
  x: number;
}
interface Point {
  y: number;
}

namespace MergedNS {
  export const A = 1;
}
namespace MergedNS {
  export const B = 2;
}

describe("Declaration merging")
  .it("merged interface has both fields")
  .expect(
    (() => {
      const p: Point = { x: 10, y: 20 };
      return p.x + p.y;
    })
  ).toBe(30)
  .it("merged namespaces combine exports")
  .expect(
    (() => {
      return MergedNS.A + MergedNS.B;
    })
  ).toBe(3)
  .it("merged namespace in expression")
  .expect(
    (() => {
      return MergedNS.A * MergedNS.B;
    })
  ).toBe(2)

done();
