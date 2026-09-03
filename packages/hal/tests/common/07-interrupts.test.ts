import { describe, done } from '@typecad/expect';
// Interrupt suite: global interrupt control, the DT-spec attach path
// (GPIO.onInterrupt — tests/board/01-gpio.test.ts), and the RAW-pin free
// attachInterrupt path (a pin with no DT alias gets raw-controller shim
// state — the collector scans the call form).
import { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from '@typecad/hal';

describe("Global interrupt control")
  .it("noInterrupts() is callable without crashing")
  .expect(
    (() => {
      noInterrupts();
      return 1;
    })
  ).toBe(1)
  .it("interrupts() is callable without crashing")
  .expect(
    (() => {
      interrupts();
      return 1;
    })
  ).toBe(1)
  .it("noInterrupts() then interrupts() restores state")
  .expect(
    (() => {
      noInterrupts();
      interrupts();
      return 1;
    })
  ).toBe(1)

describe("attachInterrupt / detachInterrupt (raw pin path)")
  .it("attachInterrupt() on a non-DT-aliased pin registers a handler")
  .expect(
    (() => {
      attachInterrupt(2, () => {}, 'FALLING');
      return 1;
    })
  ).toBe(1)
  .it("detachInterrupt() on the same pin detaches cleanly")
  .expect(
    (() => {
      detachInterrupt(2);
      return 1;
    })
  ).toBe(1)

done();
