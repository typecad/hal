import { describe, done } from '@typecad/expect';

describe("Basics")
  .it("basic math")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return b - a;
    })
  ).toBe(1)
  .expect(
    (() => {
      let b = 2;
      let c = 3;
      return b * c;
    })
  ).toBe(6)
  .it("Variable assignment")
  .expect(
    (() => {
      const a = 1;
      return a;
    })
  ).toBe(1)
  .expect(
    (() => {
      let b = 2;
      return b;
    })
  ).toBe(2)
  .expect(
    (() => {
      let c = 3;
      return c;
    })
  ).toBe(3)
  .it("Functions")
  .expect(
    (() => {
      function add(a: number, b: number): number {
        return a + b;
      }
      return add(1, 2);
    })
  ).toBe(3)
  .expect(
    (() => {
      function clamp(value: number, min: number = 0, max: number = 1023): number {
        return Math.max(min, Math.min(max, value));
      }
      return clamp(2000, 0);
    })
  ).toBe(1023)
  .it("Arrays")
  .expect(
    (() => {
      const uint8array = new Uint8Array([0xAA, 0x10, 0x20]);
      return uint8array[1];
    })
  ).toBe(0x10)
  .expect(
    (() => {
      const int16array = new Int16Array([4, -2, 7]);
      return int16array[1];
    })
  ).toBe(-2)
  .expect(
    (() => {
      const float32array = new Float32Array([1.0, 0.5, 0.25]);
      return float32array[1];
    })
  ).toBe(0.5)
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: undefined };
      return config.low;
    })
  ).toBe(150)
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: undefined };
      const { low } = config;
      return low;
    })
  ).toBe(150)
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: undefined };
      const { timeout = 500 } = config;
      return timeout;
    })
  ).toBe(500)

done();
