import { describe, done } from '@typecad/expect';
// @typecad-requires-roles pwm, pwmAlt, pwmMaxFrequency, pwmResolutionBits
// Shared board-level PWM/tone suite. PWM-capable pins and the expected
// frequency/resolution come from the board package's test-pins.json; the
// fact assertions cross-check the board package's declared data against
// what the silicon reports at runtime.
import { PWM_PIN, PWM_ALT, PWM_MAX_FREQ, PWM_RESOLUTION_BITS } from '@typecad/test-pins';

describe("OutputPin tone")
  .it("OutputPin.tone() returns a ToneChain usable with .for()")
  .expect(
    (() => {
      const out = PWM_ALT.asOutput();
      out.tone(440).for(50);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.toneFor() is callable")
  .expect(
    (() => {
      const out = PWM_ALT.asOutput();
      out.toneFor(880, 20);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.noTone() is callable")
  .expect(
    (() => {
      const out = PWM_ALT.asOutput();
      out.noTone();
      return 1;
    })
  ).toBe(1)

describe("OutputPin pwm")
  .it("OutputPin.pwm() is callable")
  .expect(
    (() => {
      const out = PWM_PIN.asOutput();
      out.pwm(50);
      return 1;
    })
  ).toBe(1)
  .it("Pin.pwm() is callable before mode conversion")
  .expect(
    (() => {
      PWM_PIN.pwm(64);
      return 1;
    })
  ).toBe(1)

describe("PWM board facts")
  .it("getPwmFrequency() matches the board-declared max frequency")
  .expect(
    (() => {
      const out = PWM_PIN.asOutput();
      return out.getPwmFrequency() === PWM_MAX_FREQ ? 1 : 0;
    })
  ).toBe(1)
  .it("getPwmResolution() matches the board-declared resolution in bits")
  .expect(
    (() => {
      const out = PWM_PIN.asOutput();
      return out.getPwmResolution() === PWM_RESOLUTION_BITS ? 1 : 0;
    })
  ).toBe(1)

done();
