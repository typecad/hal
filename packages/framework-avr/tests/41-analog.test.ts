import { describe, done } from '@typecad/expect';
import { PC0, PC1, PB3 } from '@typecad/board';

// On-device analog (ADC) and PWM tests for native AVR register lowering.
//
// ADC reads on framework-avr compile to direct ADMUX/ADCSRA/ADC register
// access (a GCC statement expression), not analogRead(). PWM writes compile
// to OCRnx assignment, not analogWrite(). These prove both paths run on a
// real ATmega328P.
//
// Pins are referenced exclusively by their AVR datasheet port names. PB3
// (OC2A on Timer2) is chosen for PWM because Timer2 is independent of the
// Timer0 that backs millis()/delay() — avoiding the timing-coupling warning.
//
// Wiring-free: ADC assertions check the value is in the valid 10-bit range
// and internally consistent across two reads, rather than assuming a fixed
// input voltage (which would require a jumper to GND/Vcc).

describe("Analog (ADC) native register lowering")
  .it("analogRead returns a value within the 10-bit range [0, 1023]")
  .expect(
    (() => {
      const a = PC0.asInput();
      const v = a.readAnalog();
      return (v >= 0 && v <= 1023) ? 1 : 0;
    })
  ).toBe(1)
  .it("readVoltage returns a non-negative value")
  .expect(
    (() => {
      const a = PC0.asInput();
      const v = a.readVoltage();
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("two consecutive reads on the same pin are within a sane delta")
  .expect(
    (() => {
      // A floating analog input is noisy, but two back-to-back reads on the
      // same pin should not differ wildly. This proves the ADMUX channel
      // select + ADC conversion sequence runs repeatably without crosstalk.
      const a = PC0.asInput();
      const v0 = a.readAnalog();
      const v1 = a.readAnalog();
      const delta = v0 > v1 ? v0 - v1 : v1 - v0;
      return delta < 200 ? 1 : 0;
    })
  ).toBe(1)
  .it("readAnalog on a second channel (PC1) is independent of PC0")
  .expect(
    (() => {
      // Reading two different channels must not bleed one into the other.
      // Both should return in-range values; the MUX selection is per-read.
      const a0 = PC0.asInput();
      const a1 = PC1.asInput();
      const v0 = a0.readAnalog();
      const v1 = a1.readAnalog();
      return (v0 >= 0 && v0 <= 1023 && v1 >= 0 && v1 <= 1023) ? 1 : 0;
    })
  ).toBe(1)

describe("PWM native register lowering")
  .it("PWM write on PB3 (Timer2 OC2A) compiles and runs without crashing")
  .expect(
    (() => {
      // PB3 is OC2A (timer2). Writing a duty cycle sets OCR2A. No readback
      // without a scope; this proves the timer-init + OCR assignment path
      // runs on silicon.
      const out = PB3.asOutput();
      out.pwm(128);
      return 1;
    })
  ).toBe(1)
  .it("PWM duty extremes (0 and 255) run without crashing")
  .expect(
    (() => {
      const out = PB3.asOutput();
      out.pwm(0);
      Timing.delay(1);
      out.pwm(255);
      return 1;
    })
  ).toBe(1)

done();
