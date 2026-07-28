import { describe, done } from '@typecad/expect';

describe("Data lookup patterns")
  .it("array-based uniqueness check")
  .expect(
    (() => {
      const seen = new Uint8Array([42, 99, 0, 0]);
      let found = 0;
      for (let i = 0; i < 4; i++) {
        if (seen[i] === 42) {
          found = 1;
          break;
        }
      }
      return found;
    })
  ).toBe(1)
  .expect(
    (() => {
      const seen = new Uint8Array([42, 99, 0, 0]);
      let found = 0;
      for (let i = 0; i < 4; i++) {
        if (seen[i] === 100) {
          found = 1;
          break;
        }
      }
      return found;
    })
  ).toBe(0)
  .it("parallel arrays for key-value lookup")
  .expect(
    (() => {
      const keys = [10, 20, 30];
      const vals = [100, 200, 300];
      let result = 0;
      for (let i = 0; i < 3; i++) {
        if (keys[i] === 20) {
          result = vals[i];
          break;
        }
      }
      return result;
    })
  ).toBe(200)
  .it("array overwrite value")
  .expect(
    (() => {
      const keys = [10, 20, 30];
      const vals = [100, 200, 300];
      vals[1] = 250;
      let result = 0;
      for (let i = 0; i < 3; i++) {
        if (keys[i] === 20) {
          result = vals[i];
          break;
        }
      }
      return result;
    })
  ).toBe(250)
  .it("counting occurrences")
  .expect(
    (() => {
      const data = [5, 3, 5, 7, 5, 2];
      let count = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 5) {
          count++;
        }
      }
      return count;
    })
  ).toBe(3)

done();
