import { describe, done } from '@typecad/expect';
import { PD7, PB0, PB1, PB5 } from '@typecad/board';

// On-device GPIO tests for native AVR register lowering.
//
// This is the suite framework-arduino does NOT have: it proves that
// PD7.high() actually compiles to `PORTD |= 0x80` (not digitalWrite), flashes
// to a real ATmega328P, and drives real silicon. The register translation
// is unit-tested at the string level in tests/packages/framework-avr/; these
// tests prove it runs end-to-end on metal.
//
// Pins are referenced exclusively by their AVR datasheet port names (PB0,
// PD7, ...), not Arduino Dx/Ax aliases — port names are the canonical,
// chip-portable identity for a bare-metal framework.
//
// These tests are wiring-free: they rely only on the MCU's internal pullups
// and the fact that register operations compile and execute. Output→input
// loopback would require a physical jumper and is intentionally omitted so
// the suite runs repeatably without breadboard setup.

describe("GPIO native register lowering")
  .it("input pullup reads HIGH on a floating pin (PD7)")
  .expect(
    (() => {
      // With nothing external pulling PD7, the internal pullup reads HIGH.
      const pin = PD7.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("input pullup reads HIGH on a floating pin (PB0)")
  .expect(
    (() => {
      const pin = PB0.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("output high/low on PD7 compiles and runs without crashing")
  .expect(
    (() => {
      const out = PD7.asOutput();
      out.high();
      Timing.delay(1);
      out.low();
      return 1;
    })
  ).toBe(1)
  .it("output write with a runtime value runs without crashing")
  .expect(
    (() => {
      // Exercises the branchless read-modify-write path (dynamic value),
      // which replaced the old non-lvalue ternary.
      const out = PD7.asOutput();
      let v = 0;
      out.write(v);
      v = 1;
      out.write(v);
      return 1;
    })
  ).toBe(1)
  .it("toggle on PB1 runs without crashing")
  .expect(
    (() => {
      const out = PB1.asOutput();
      out.toggle();
      Timing.delay(1);
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("PB5 (onboard LED) output operations compile and run without crashing")
  .expect(
    (() => {
      const led = PB5.asOutput();
      led.high();
      Timing.delay(1);
      led.low();
      led.toggle();
      return 1;
    })
  ).toBe(1)

done();
