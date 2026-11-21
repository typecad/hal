import { describe, done } from '@typecad/hal/testing';
// USB CDC console suite — the USB0 singleton. BOARD NOTE: this test runs
// where the board's console does NOT ride the CDC port (blackpill: the
// protocol console is usart1, so the CDC device is free for user code; the
// port idles until a host opens it — writes drain into the CDC buffer and
// are simply unread). On boards whose protocol channel IS the CDC port
// (esp32s3 rigs route [TC: over the USB bridge), exclude this file the way
// 08-uart is excluded there.
import { USB0 } from '@typecad/hal';

describe("USB CDC console")
  .it("USB0.writeLine(...) with no construction is callable")
  .expect(
    (() => {
      USB0.writeLine('usb direct');
      return 1;
    })
  ).toBe(1)
  .it("USB0.write(...) is callable")
  .expect(
    (() => {
      USB0.write('usb write');
      return 1;
    })
  ).toBe(1)
  .it("USB0.write() of a number formats without crashing")
  .expect(
    (() => {
      USB0.write(42);
      return 1;
    })
  ).toBe(1)
  .it("USB0.read() on the unopened port is -1 (poll semantics)")
  .expect(
    (() => {
      return USB0.read();
    })
  ).toBe(-1)
  .it("USB0.available() on the unopened port is 0")
  .expect(
    (() => {
      return USB0.available();
    })
  ).toBe(0)

done();
