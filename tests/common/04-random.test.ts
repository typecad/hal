import { describe, done } from '@typecad/hal/testing';
import { Random } from '@typecad/hal';

describe("Random namespace")
  .it("Random.seed() is callable without crashing")
  .expect(
    (() => {
      Random.seed(99);
      return 1;
    })
  ).toBe(1)
  .it("Random.upTo(max) returns a value within [0, max-1]")
  .expect(
    (() => {
      const v = Random.upTo(50);
      return (v >= 0 && v <= 49) ? 1 : 0;
    })
  ).toBe(1)
  .it("Random.between(min, max) returns a value within [min, max-1]")
  .expect(
    (() => {
      const v = Random.between(20, 30);
      return (v >= 20 && v <= 29) ? 1 : 0;
    })
  ).toBe(1)
  .it("Random.int() returns a non-negative value")
  .expect(
    (() => {
      Random.seed(7);
      return Random.int() >= 0 ? 1 : 0;
    })
  ).toBe(1)

done();
