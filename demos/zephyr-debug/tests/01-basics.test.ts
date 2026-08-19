// ---------------------------------------------------------------------------
// Hardware test — Basics
//
// Runs on the board via `npm run test:hw` (cuttlefish-test). Each test file is
// transpiled, flashed to the board, and its assertions are evaluated on the host
// over serial. Change the serial port in cuttlefish.config.ts (the `test.port`
// field) or override it with the CUTTLEFISH_PORT env var.
//
// API: describe(...).it(...).expect(value).<matcher>() chains. Import pin
// objects from '@typecad/board' to assert on real hardware I/O. Every file ends
// with done().
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';

describe("Basics")
  .it("adds two numbers")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .it("multiplies two numbers")
  .expect(
    (() => {
      let a = 3;
      let b = 4;
      return a * b;
    })
  ).toBe(12)
  .it("reads an array element")
  .expect(
    (() => {
      const data = new Uint8Array([0xAA, 0x10, 0x20]);
      return data[1];
    })
  ).toBe(0x10)
  .it("clamps a value to a range")
  .expect(
    (() => {
      const value = 2000;
      return Math.max(0, Math.min(1023, value));
    })
  ).toBe(1023);

done();
