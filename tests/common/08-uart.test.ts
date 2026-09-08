import { describe, done } from '@typecad/hal/testing';
// UART suite — the board's UART0 singleton is the DIRECT surface
// (UART0.writeLine(...) with no construction), and explicit construction
// remains for non-default facts: from the bus instance (new UART(UART0,
// { baud })) or the name. The Zephyr console rides the USB CDC port, so the
// board's hardware UART is free for user code with nothing attached: writes
// drain to an idle line and the rx poll reads -1 (Zephyr poll semantics).
import { UART, UART0 } from '@typecad/hal';

describe("UART direct singleton")
  .it("UART0.writeLine(...) with no construction is callable")
  .expect(
    (() => {
      UART0.writeLine('hello direct');
      return 1;
    })
  ).toBe(1)
  .it("UART0.write(...) is callable")
  .expect(
    (() => {
      UART0.write('hello');
      return 1;
    })
  ).toBe(1)
  .it("UART0.available() is callable on the idle line")
  .expect(
    (() => {
      return UART0.available();
    })
  ).toBe(0)

describe("UART construction")
  .it("UART(UART0, baud) from the board instance is accepted")
  .expect(
    (() => {
      const ser = new UART(UART0, { baud: 115200 });
      ser.write('hello');
      return 1;
    })
  ).toBe(1)
  .it("UART with default baud and custom rx buffer is accepted")
  .expect(
    (() => {
      const ser = new UART('UART0', { rxBufferBytes: 128 });
      ser.write('x');
      return 1;
    })
  ).toBe(1)

describe("UART output")
  .it("write() is callable")
  .expect(
    (() => {
      const ser = new UART('UART0', { baud: 115200 });
      ser.write('AT\r\n');
      return 1;
    })
  ).toBe(1)
  .it("writeLine() appends a newline")
  .expect(
    (() => {
      const ser = new UART('UART0', { baud: 115200 });
      ser.writeLine('line');
      return 1;
    })
  ).toBe(1)
  .it("write() with a longer payload is callable")
  .expect(
    (() => {
      const ser = new UART('UART0', { baud: 115200 });
      ser.write('the quick brown fox jumps over the lazy dog');
      return 1;
    })
  ).toBe(1)

describe("UART input (idle line)")
  .it("read() returns -1 on the direct singleton too")
  .expect(
    (() => {
      return UART0.read();
    })
  ).toBe(-1)
  .it("read() returns -1 on an idle line (poll semantics)")
  .expect(
    (() => {
      const ser = new UART('UART0', { baud: 115200 });
      return ser.read();
    })
  ).toBe(-1)

done();
