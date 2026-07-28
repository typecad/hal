import { describe, done } from '@typecad/expect';

describe("Volatile variables")
  .it("volatile integer for ISR-shared state")
  .expect(
    (() => {
      let counter = volatile(0);
      counter++;
      counter++;
      counter++;
      return counter;
    })
  ).toBe(3)
  .it("volatile in loop condition")
  .expect(
    (() => {
      let done_flag = volatile(0);
      let iterations = 0;
      for (let i = 0; i < 10; i++) {
        iterations++;
        if (i === 4) {
          done_flag = 1;
        }
        if (done_flag) {
          break;
        }
      }
      return iterations;
    })
  ).toBe(5)
  .it("volatile typed array")
  .expect(
    (() => {
      const buf = volatile(new Uint8Array([10, 20, 30]));
      return buf[1];
    })
  ).toBe(20)
  .it("volatile buffer write and read")
  .expect(
    (() => {
      const reg = volatile(new Uint8Array([0, 0, 0]));
      reg[0] = 200;
      reg[1] = 55;
      return reg[0] + reg[1];
    })
  ).toBe(255)

done();
