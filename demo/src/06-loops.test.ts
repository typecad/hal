import { describe, done } from '@typecode/expect';

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
