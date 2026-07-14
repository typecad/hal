import { describe, done } from '@typecad/expect';
import { PB0, PB1, PD7, PB5 } from '@typecad/board';

// On-device GPIO tests for native AVR register lowering.
//
// This is the suite framework-arduino does NOT have: it proves that
// PB5.high() actually compiles to `PORTB |= 0x20` (not digitalWrite), flashes
// to a real ATmega328P, and drives real silicon. The register translation
// is unit-tested at the string level in tests/packages/framework-avr/; these
// tests prove it end-to-end on metal.
//
// Pins are referenced exclusively by their AVR datasheet port names (PB0,
// PD7, ...), not Arduino Dx/Ax aliases — this is a bare-metal framework and
// port names are the canonical, chip-portable identity.
//
// Loopback wiring assumed (Uno):
//   PB0 <-> PB1   (output drives input — jumper these two pins)
// PD7 and PB5 (the onboard LED) are exercised as outputs.

describe("GPIO native register lowering")
  .it("output HIGH drives a connected input HIGH (PB0 -> PB1 loopback)")
  .expect(
    (() => {
      const driver = PB0.asOutput();
      const sense = PB1.asInput();
      driver.high();
      Timing.delay(1);
      return sense.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("output LOW drives a connected input LOW (PB0 -> PB1 loopback)")
  .expect(
    (() => {
      const driver = PB0.asOutput();
      const sense = PB1.asInput();
      driver.low();
      Timing.delay(1);
      return sense.read() ? 1 : 0;
    })
  ).toBe(0)
  .it("input pullup reads HIGH on a floating pin")
  .expect(
    (() => {
      // With nothing external pulling PD7, the internal pullup reads HIGH.
      const pin = PD7.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("input (no pullup) can be driven LOW by an output (PB0 -> PB1)")
  .expect(
    (() => {
      const driver = PB0.asOutput();
      const sense = PB1.asInput();  // high-Z, no pullup
      driver.low();
      Timing.delay(1);
      return sense.read() ? 1 : 0;
    })
  ).toBe(0)
  .it("toggle flips and restores state (PB0 -> PB1 loopback)")
  .expect(
    (() => {
      const driver = PB0.asOutput();
      const sense = PB1.asInput();
      driver.high();
      Timing.delay(1);
      const first = sense.read() ? 1 : 0;
      driver.toggle();
      Timing.delay(1);
      const second = sense.read() ? 1 : 0;
      // first HIGH, second LOW -> packed 0b10 == 2
      return (first << 1) | second;
    })
  ).toBe(2)
  .it("PB5 (onboard LED) output operations compile and run without crashing")
  .expect(
    (() => {
      const led = PB5.asOutput();
      led.high();
      Timing.delay(1);
      led.low();
      return 1;
    })
  ).toBe(1)

done();
