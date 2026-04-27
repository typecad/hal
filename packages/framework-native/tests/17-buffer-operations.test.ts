import { describe, done } from '@typecode/expect';

describe("Buffer operations")
  .it("sequential byte writing")
  .expect(
    (() => {
      const buf = new Uint8Array(4);
      buf[0] = 0xFF;
      buf[1] = 0x0A;
      buf[2] = 0x1F;
      buf[3] = 0x00;
      return buf[1];
    })
  ).toBe(0x0A)
  .it("computed index access")
  .expect(
    (() => {
      const buf = new Uint8Array(8);
      const offset = 2;
      buf[offset + 1] = 0x42;
      return buf[3];
    })
  ).toBe(0x42)
  .it("buffer read and sum")
  .expect(
    (() => {
      const buf = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        sum += buf[i];
      }
      return sum;
    })
  ).toBe(0xA0)
  .it("multi-byte value packing into buffer")
  .expect(
    (() => {
      const buf = new Uint8Array(4);
      const value = 0x1234;
      buf[0] = (value >> 8) & 0xFF;
      buf[1] = value & 0xFF;
      return buf[0];
    })
  ).toBe(0x12)
  .it("buffer length in loop")
  .expect(
    (() => {
      const buf = new Uint8Array([5, 10, 15, 20, 25]);
      let count = 0;
      for (let i = 0; i < buf.length; i++) {
        count++;
      }
      return count;
    })
  ).toBe(5)
  .it("buffer element swap")
  .expect(
    (() => {
      const buf = new Uint8Array([1, 2, 3, 4]);
      const temp = buf[0];
      buf[0] = buf[3];
      buf[3] = temp;
      return buf[0] + buf[3];
    })
  ).toBe(5)

done();
