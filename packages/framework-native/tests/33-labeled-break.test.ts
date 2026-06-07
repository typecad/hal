import { describe, done } from '@typecad/expect';

describe("Labeled break")
  .it("break outer for loop")
  .expect(
    (() => {
      let result = 0;
      outerLoop: for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          result = i * 10 + j;
          if (i === 1 && j === 1) break outerLoop;
        }
      }
      return result;
    })
  ).toBe(11)
  .it("break outer while loop")
  .expect(
    (() => {
      let sum = 0;
      let i = 0;
      outer: while (i < 10) {
        let j = 0;
        while (j < 10) {
          sum += 1;
          if (sum > 5) break outer;
          j++;
        }
        i++;
      }
      return sum;
    })
  ).toBe(6)
  .it("labeled break exits immediately")
  .expect(
    (() => {
      let count = 0;
      outer: for (let i = 0; i < 5; i++) {
        count++;
        for (let j = 0; j < 5; j++) {
          if (i === 0) break outer;
        }
      }
      return count;
    })
  ).toBe(1)

done();
