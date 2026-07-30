import { describe, done } from '@typecad/expect';

// On-device language-basics tests for the Zephyr framework. Proves the
// transpiled C++ compiles (via west build), flashes to the XIAO nRF52840, and
// executes correctly on metal. Mirrors framework-avr/tests/01-basics.

describe("Basics")
  .it("basic math")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .it("Variable assignment")
  .expect(
    (() => {
      const a = 1;
      return a;
    })
  ).toBe(1)
  .it("Functions")
  .expect(
    (() => {
      function add(a: number, b: number): number {
        return a + b;
      }
      return add(1, 2);
    })
  ).toBe(3)
  .it("Arrays")
  .expect(
    (() => {
      const uint8array = new Uint8Array([0xAA, 0x10, 0x20]);
      return uint8array[1];
    })
  ).toBe(0x10)
  .it("Object destructuring with defaults")
  .expect(
    (() => {
      const config = { low: 150, high: 700, timeout: undefined };
      const { timeout = 500 } = config;
      return timeout;
    })
  ).toBe(500)

done();
