import { describe, done } from '@typecad/expect';

describe("Free random functions")
  .it("randomSeed() is callable without crashing")
  .expect(
    (() => {
      randomSeed(99);
      return 1;
    })
  ).toBe(1)
  .it("random(max) returns a value within [0, max-1]")
  .expect(
    (() => {
      const v = random(50);
      return (v >= 0 && v <= 49) ? 1 : 0;
    })
  ).toBe(1)
  .it("random(min, max) returns a value within [min, max-1]")
  .expect(
    (() => {
      const v = random(20, 30);
      return (v >= 20 && v <= 29) ? 1 : 0;
    })
  ).toBe(1)
  .it("random(max) with max=1 always returns 0")
  .expect(
    (() => {
      randomSeed(7);
      return random(1);
    })
  ).toBe(0)

done();
