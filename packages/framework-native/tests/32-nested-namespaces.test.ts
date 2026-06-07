import { describe, done } from '@typecad/expect';

namespace Outer {
  export const X = 10;
  namespace Inner {
    export const Y = 20;
    export function add(a: number, b: number): number {
      return a + b;
    }
  }
}

namespace Outer2 {
  export const A = 5;
  namespace Deep {
    export const B = 15;
    namespace Deeper {
      export const C = 25;
    }
  }
}

describe("Nested namespaces")
  .it("access outer namespace member")
  .expect(
    (() => {
      return Outer.X;
    })
  ).toBe(10)
  .it("access nested namespace member")
  .expect(
    (() => {
      return Outer.Inner.Y;
    })
  ).toBe(20)
  .it("call nested namespace function")
  .expect(
    (() => {
      return Outer.Inner.add(3, 4);
    })
  ).toBe(7)
  .it("outer plus inner value")
  .expect(
    (() => {
      return Outer.X + Outer.Inner.Y;
    })
  ).toBe(30)
  .it("deeply nested three levels")
  .expect(
    (() => {
      return Outer2.A + Outer2.Deep.B + Outer2.Deep.Deeper.C;
    })
  ).toBe(45)

done();
