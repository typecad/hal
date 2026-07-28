import { describe, done } from '@typecad/expect';

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

done();
