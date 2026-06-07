import { describe, done } from '@typecad/expect';

describe("Generator-like patterns")
  .it("loop accumulating values")
  .expect(
    (() => {
      let total = 0;
      for (let i = 1; i <= 4; i++) {
        total += i;
      }
      return total;
    })
  ).toBe(10)
  .it("loop doubling values")
  .expect(
    (() => {
      let sum = 0;
      let val = 1;
      while (val <= 8) {
        sum += val;
        val = val * 2;
      }
      return sum;
    })
  ).toBe(15)
  .it("conditional accumulation")
  .expect(
    (() => {
      let sum = 0;
      for (let i = 0; i < 6; i++) {
        if (i % 2 === 0) sum += i;
      }
      return sum;
    })
  ).toBe(6)

done();
