import { describe, done } from '@typehal/expect';

describe("Variables and Scoping")
  .it("const and let assignment")
  .expect(
    (() => {
      const fixed = 10;
      let mutable = 5;
      mutable += fixed;
      return mutable;
    })()
  ).toBe(15)

  .it("block scoping (shadowing)")
  .expect(
    (() => {
      let x = 1;
      {
        let x = 2; // Should not overwrite outer x in C++
      }
      return x;
    })
  ).toBe(1)

  // .it("var hoisting (function scope)")
  //   .expect(
  //     (() => {
  //       // @ts-ignore: testing legacy var behavior
  //       var result = (foo === undefined); // var exists but is uninitialized
  //       if (false) { var foo = 1; }
  //       return result;
  //     })()
  //   ).toBe(true)

  .it("object destructuring and aliasing")
    .expect(
      (() => {
        const user = { id: 42, name: "Alice" };
        const { id: userId, name } = user;
        return userId;
      })()
    ).toBe(42)

  .it("nested object destructuring")
    .expect(
      (() => {
        const meta = { data: { status: 200 } };
        const { data: { status } } = meta;
        return status;
      })()
    ).toBe(200)

  .it("array destructuring with rest")
    .expect(
      (() => {
        const [first, second, ...rest] = [10, 20, 30, 40];
        return rest.length;
      })()
    ).toBe(2)

  // .it("const assertions (as const)")
  //   .expect(
  //     (() => {
  //       const colors = ["red", "blue"] as const;
  //       // In transpilation, this should treat the array as a fixed-size tuple/std::array
  //       return colors[0];
  //     })()
  //   ).toBe("red");

done();
