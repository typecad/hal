import { describe, done } from '@typecode/expect';

describe("Increment and decrement")
  .it("postfix increment")
  .expect(
    (() => {
      let a = 5;
      const before = a++;
      return before;
    })
  ).toBe(5)
  .expect(
    (() => {
      let a = 5;
      a++;
      return a;
    })
  ).toBe(6)
  .it("prefix increment")
  .expect(
    (() => {
      let a = 5;
      return ++a;
    })
  ).toBe(6)
  .it("postfix decrement")
  .expect(
    (() => {
      let a = 5;
      const before = a--;
      return before;
    })
  ).toBe(5)
  .expect(
    (() => {
      let a = 5;
      a--;
      return a;
    })
  ).toBe(4)
  .it("prefix decrement")
  .expect(
    (() => {
      let a = 5;
      return --a;
    })
  ).toBe(4)

describe("Boolean values")
  .it("true coerced to number")
  .expect(
    (() => {
      const flag = true;
      return flag ? 1 : 0;
    })
  ).toBe(1)
  .it("false coerced to number")
  .expect(
    (() => {
      const flag = false;
      return flag ? 1 : 0;
    })
  ).toBe(0)
  .it("truthy and falsy via toBeTruthy/toBeFalsy")
  .expect((() => 1)).toBeTruthy()
  .expect((() => 0)).toBeFalsy()
  .expect((() => 42)).toBeTruthy()

describe("Bitwise compound assignment")
  .it("&= operator")
  .expect(
    (() => {
      let val = 0xFF;
      val &= 0x0F;
      return val;
    })
  ).toBe(0x0F)
  .it("|= operator")
  .expect(
    (() => {
      let val = 0xF0;
      val |= 0x0F;
      return val;
    })
  ).toBe(0xFF)
  .it("^= operator")
  .expect(
    (() => {
      let val = 0xFF;
      val ^= 0x0F;
      return val;
    })
  ).toBe(0xF0)
  .it("<<= operator")
  .expect(
    (() => {
      let val = 1;
      val <<= 4;
      return val;
    })
  ).toBe(16)
  .it(">>= operator")
  .expect(
    (() => {
      let val = 256;
      val >>= 4;
      return val;
    })
  ).toBe(16)
  .it("%= operator")
  .expect(
    (() => {
      let val = 17;
      val %= 5;
      return val;
    })
  ).toBe(2)

describe("Nullish coalescing")
  .it("nullish fallback to value")
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: undefined };
      const timeout: number = config.timeout ?? 1000;
      return timeout;
    })
  ).toBe(1000)
  .it("non-nullish passes through")
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: 500 };
      const timeout: number = config.timeout ?? 1000;
      return timeout;
    })
  ).toBe(500)

describe("Logical NOT")
  .it("negation of comparison")
  .expect(
    (() => {
      const a = 5;
      return !(a === 5) ? 1 : 0;
    })
  ).toBe(0)
  .expect(
    (() => {
      const a:number = 5;
      return !(a === 3) ? 1 : 0;
    })
  ).toBe(1)

describe("Type assertions (as)")
  .it("as number unwraps correctly")
  .expect(
    (() => {
      const val = 42 as number;
      return val;
    })
  ).toBe(42)

describe("Logical assignment operators")
  .it("||= operator")
  .expect(
    (() => {
      let x: number | undefined = undefined;
      x ||= 10;
      return x as number;
    })
  ).toBe(10)
  .it("&&= operator")
  .expect(
    (() => {
      let x = 5;
      x &&= 10;
      return x;
    })
  ).toBe(10)

done();
