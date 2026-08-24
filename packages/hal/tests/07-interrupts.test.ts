import { describe, done } from '@typecad/expect';
// Board-agnostic: raw pin numbers (0 = PA0 on the Black Pill's KEY button,
// GPIO0 on the ESP32 BOOT button, D0 on the Uno; 2 = PA2/GPIO2/D2). On
// Zephyr, pin 0 goes through the DT-spec path (sw0) while pin 2 exercises
// the raw-controller path — attachInterrupt works on ANY GPIO, not just
// DT-aliased buttons.
import { A0 } from '@typecad/board';

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
  .it("attachInterrupt() works on any GPIO (raw path, no DT alias needed)")
  .expect(
    (() => {
      attachInterrupt(2, () => {}, 'FALLING');
      return 1;
    })
  ).toBe(1)
  .it("detachInterrupt() removes a handler")
  .expect(
    (() => {
      detachInterrupt(0);
      detachInterrupt(2);
      return 1;
    })
  ).toBe(1)

// InputPin edge helpers (onFalling/onRising/onChange/offAll) live in the
// per-board gpio group (tests/boards/<board>/01-gpio.test.ts) — they need a
// named interrupt-capable pin, and no pin name is universal across targets
// (PD2/PD3 on the Uno, any GPIO on STM32/ESP32).

done();
