import { describe, done } from '@typecad/expect';


describe("Arithmetic operators")
  .it("division and modulo")
  .expect((() => 10 % 3)).toBe(1)
  .expect((() => 7 % 2)).toBe(1)
  .it("unary negation")
  .expect(
    (() => {
      const a = 1;
      return -a;
    })
  ).toBe(-1)
  .expect(
    (() => {
      const negative = -42;
      return -negative;
    })
  ).toBe(42)
  .it("order of operations")
  .expect((() => 2 + 3 * 4)).toBe(14)
  .it("parenthesized expressions")
  .expect((() => (2 + 3) * 4)).toBe(20)
  .expect((() => 2 * (3 + 4))).toBe(14)
  .expect((() => (1 + 2) * (3 + 4))).toBe(21)

describe("Number literals")
  .it("hex literal")
  .expect((() => { const hex = 0xFF; return hex; })).toBe(255)
  .it("binary literal")
  .expect((() => { const binary = 0b1010; return binary; })).toBe(10)
  .it("octal literal")
  .expect((() => { const octal = 0o77; return octal; })).toBe(63)
  .it("negative literal")
  .expect((() => { const negative = -42; return negative; })).toBe(-42)
  .it("floating point literal")
  .expect(
    (() => {
      const floating = 3.14;
      return floating;
    })
  ).toBeCloseTo(3.14, 1)

describe("Compound assignment")
  .it("+=, -=, *=, /=")
  .expect(
    (() => {
      let mut = 10;
      return mut;
    })
  ).toBe(10)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      return mut;
    })
  ).toBe(15)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      return mut;
    })
  ).toBe(12)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      mut *= 2;
      return mut;
    })
  ).toBe(24)
  .expect(
    (() => {
      let mut = 10;
      mut += 5;
      mut -= 3;
      mut *= 2;
      mut /= 4;
      return mut;
    })
  ).toBe(6)



describe("Comparison via ternary")
  .it("equality and inequality")
  .expect(
    (() => {
      let n5: number = 5;
      return n5 === n5 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 === n3 ? 1 : 0;
    })
  ).toBe(0)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 !== n3 ? 1 : 0;
    })
  ).toBe(1)
  .it("less than / greater than")
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n3 < n5 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 > n3 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 < n3 ? 1 : 0;
    })
  ).toBe(0)
  .it("less or equal / greater or equal")
  .expect(
    (() => {
      let n5: number = 5;
      return n5 <= n5 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n3 <= n5 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n5: number = 5;
      return n5 >= n5 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 >= n3 ? 1 : 0;
    })
  ).toBe(1)

describe("Logical operators via numeric patterns")
  .it("logical AND")
  .expect(
    (() => {
      let n1: number = 1;
      let n2: number = 2;
      return n1 === n1 && n2 === n2 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n1: number = 1;
      let n2: number = 2;
      let n3: number = 3;
      return n1 === n1 && n2 === n3 ? 1 : 0;
    })
  ).toBe(0)
  .it("logical OR")
  .expect(
    (() => {
      let n1: number = 1;
      let n2: number = 2;
      let n3: number = 3;
      return n1 === n1 || n2 === n3 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n1: number = 1;
      let n2: number = 2;
      let n3: number = 3;
      return n1 === n3 || n2 === n3 ? 1 : 0;
    })
  ).toBe(0)
  .it("logical NOT")
  .expect(
    (() => {
      let n1: number = 1;
      let n3: number = 3;
      return n1 !== n3 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n1: number = 1;
      return n1 !== n1 ? 1 : 0;
    })
  ).toBe(0)

describe("Bitwise operators")
  .it("AND, OR, XOR")
  .expect((() => 0xFF & 0x0F)).toBe(0x0F)
  .expect((() => 0xF0 | 0x0F)).toBe(0xFF)
  .expect((() => 0xFF ^ 0x0F)).toBe(0xF0)
  .it("shifts and NOT")
  .expect((() => 1 << 4)).toBe(16)
  .expect((() => 256 >> 4)).toBe(16)
  .expect((() => ~0)).toBe(-1)



describe("Ternary expressions")
  .it("simple ternary")
  .expect(
    (() => {
      let n1: number = 1;
      let n3: number = 3;
      return n1 === n1 ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      let n1: number = 1;
      let n3: number = 3;
      return n1 === n3 ? 1 : 0;
    })
  ).toBe(0)
  .it("nested ternary")
  .expect(
    (() => {
      let n3: number = 3;
      let n5: number = 5;
      return n5 > 10 ? 1 : n5 > n3 ? 2 : 3;
    })
  ).toBe(2)

describe("Arrow function")
  .it("arrow function call")
  .expect(
    (() => {
      const square = (x: number): number => x * x;
      return square(4);
    })
  ).toBe(16)
  .expect(
    (() => {
      const square = (x: number): number => x * x;
      return square(7);
    })
  ).toBe(49)

describe("For-of loop")
  .it("for-of accumulation")
  .expect(
    (() => {
      const scores: ReadonlyArray<number> = [10, 20, 30, 40];
      let total = 0;
      for (const value of scores) {
        total += value;
      }
      return total;
    })
  ).toBe(100)



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



describe("For loop (C-style)")
  .it("basic for loop")
  .expect(
    (() => {
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        sum += i;
      }
      return sum;
    })
  ).toBe(10)
  .it("for loop with break")
  .expect(
    (() => {
      let sum = 0;
      for (let i = 0; i < 100; i++) {
        if (i >= 3) break;
        sum += i;
      }
      return sum;
    })
  ).toBe(3)
  .it("for loop with continue")
  .expect(
    (() => {
      let sum = 0;
      for (let i = 0; i < 6; i++) {
        if (i % 2 === 0) continue;
        sum += i;
      }
      return sum;
    })
  ).toBe(9)

describe("While loop")
  .it("basic while loop")
  .expect(
    (() => {
      let n = 1;
      let result = 1;
      while (n < 5) {
        result *= n;
        n++;
      }
      return result;
    })
  ).toBe(24)
  .it("while with break")
  .expect(
    (() => {
      let i = 0;
      while (true) {
        if (i >= 4) break;
        i++;
      }
      return i;
    })
  ).toBe(4)

describe("Do-while loop")
  .it("basic do-while")
  .expect(
    (() => {
      let count = 0;
      let i = 0;
      do {
        count++;
        i++;
      } while (i < 3);
      return count;
    })
  ).toBe(3)
  .it("do-while executes at least once")
  .expect(
    (() => {
      let count = 0;
      let i = 10;
      do {
        count++;
        i++;
      } while (i < 10);
      return count;
    })
  ).toBe(1)

describe("Switch statement")
  .it("basic switch cases")
  .expect(
    (() => {
      const x: number = 2;
      switch (x) {
        case 1: return 10;
        case 2: return 20;
        case 3: return 30;
        default: return 0;
      }
    })
  ).toBe(20)
  .it("switch default case")
  .expect(
    (() => {
      const x: number = 99;
      switch (x) {
        case 1: return 10;
        case 2: return 20;
        default: return -1;
      }
    })
  ).toBe(-1)
  .it("switch with break between cases")
  .expect(
    (() => {
      let result = 0;
      const x: number = 1;
      switch (x) {
        case 1: result += 10; break;
        case 2: result += 20; break;
      }
      return result;
    })
  ).toBe(10)

// for-in iterates over object keys using a generated key array
.it("iterate object keys")
  .expect(
    (() => {
      const obj = { a: 10, b: 20, c: 30 };
      let count = 0;
      for (const key in obj) {
        count++;
      }
      return count;
    })
  ).toBe(3)


done();
