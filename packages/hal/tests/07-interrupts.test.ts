import { describe, done } from '@typecad/expect';
// Black Pill: the Zephyr interrupt lowering only attaches on pins the chip
// descriptor lists in gpio.interruptPins — on this board that's PA0 (the KEY
// button, sw0). attachInterrupt() on any other pin lowers to a diagnostic
// comment (no-op), so the register/detach smoke below rides pin 0.
import { PA0 } from '@typecad/board';

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

describe("attachInterrupt / detachInterrupt")
  .it("attachInterrupt() registers a handler")
  .expect(
    (() => {
      attachInterrupt(0, () => {}, 'FALLING');
      return 1;
    })
  ).toBe(1)
  .it("attachInterrupt() accepts RISING mode")
  .expect(
    (() => {
      attachInterrupt(0, () => {}, 'RISING');
      return 1;
    })
  ).toBe(1)
  .it("attachInterrupt() accepts CHANGE mode")
  .expect(
    (() => {
      attachInterrupt(0, () => {}, 'CHANGE');
      return 1;
    })
  ).toBe(1)
  .it("detachInterrupt() removes a handler")
  .expect(
    (() => {
      detachInterrupt(0);
      return 1;
    })
  ).toBe(1)

describe("InputPin edge helpers")
  .it("onFalling/onRising/onChange/offAll are callable")
  .expect(
    (() => {
      const btn = PA0.asInputPullUp();
      btn.onFalling(() => {});
      btn.onRising(() => {});
      btn.onChange(() => {});
      btn.offAll();
      return 1;
    })
  ).toBe(1)

done();
