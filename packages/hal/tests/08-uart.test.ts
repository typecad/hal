// @typecad-skip-target avr: On the Uno, UART0 is the single hardware UART and
// IS the [TC:...] protocol channel the test runner reads. Any UART0 method
// (even begin(), which re-initializes Serial mid-stream) disrupts that channel
// and the runner times out waiting for SUITE_END. The file is kept for
// transpilation coverage and runs on multi-UART targets (e.g. ESP32), where
// UART0 can be tested independently of the protocol serial.

import { describe, done } from '@typecad/expect';
import { UART0 } from '@TypeCAD';

describe("UART0 lifecycle")
  .it("UART0.begin() is callable")
  .expect(
    (() => {
      UART0.begin(115200);
      return 1;
    })
  ).toBe(1)
  .it("UART0.end() is callable")
  .expect(
    (() => {
      UART0.end();
      return 1;
    })
  ).toBe(1)

describe("UART0 output")
  .it("UART0.print() is callable")
  .expect(
    (() => {
      UART0.begin(115200);
      UART0.print("hello");
      return 1;
    })
  ).toBe(1)
  .it("UART0.println() is callable")
  .expect(
    (() => {
      UART0.println("line");
      return 1;
    })
  ).toBe(1)
  .it("UART0.write() is callable")
  .expect(
    (() => {
      UART0.write(0x41);
      return 1;
    })
  ).toBe(1)

describe("UART0 input")
  .it("UART0.available() returns a non-negative value")
  .expect(
    (() => {
      const n = UART0.available();
      return n >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("UART0.read() is callable")
  .expect(
    (() => {
      UART0.read();
      return 1;
    })
  ).toBe(1)
  .it("UART0.peek() is callable")
  .expect(
    (() => {
      UART0.peek();
      return 1;
    })
  ).toBe(1)
  .it("UART0.flush() is callable")
  .expect(
    (() => {
      UART0.flush();
      return 1;
    })
  ).toBe(1)

done();
