import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles pwm, pwmAlt
// Shared board-level PWM suite, adapted to the thin PWM class (the ambient
// The Pin fluent API (asOutput() chains) did not survive the rework;
// construction IS the channel setup, setDuty/setPulse lower through the
// overlay's synthesized pwm-leds alias). PWM-capable pins come from the
// board config's test-pins.json — silicon routes harvested from the SoC
// pinctrl files decide which pads qualify per board.
import { PWM_PIN, PWM_ALT } from '@typecad/test-pins';
import { PWM } from '@typecad/hal';

describe("PWM construction")
  .it("PWM(pin, periodNs) construction configures without crashing")
  .expect(
    (() => {
      const dim = new PWM(PWM_PIN, { periodNs: 20_000_000 });
      dim.setDuty(0.5);
      return 1;
    })
  ).toBe(1)
  .it("a second channel on another pad coexists")
  .expect(
    (() => {
      const a = new PWM(PWM_PIN, { periodNs: 20_000_000 });
      const b = new PWM(PWM_ALT, { periodNs: 20_000_000 });
      a.setDuty(0.25);
      b.setDuty(0.75);
      return 1;
    })
  ).toBe(1)

describe("PWM duty and pulse")
  .it("setDuty(0) and setDuty(1) are callable at the extremes")
  .expect(
    (() => {
      const dim = new PWM(PWM_PIN, { periodNs: 20_000_000 });
      dim.setDuty(0);
      dim.setDuty(1);
      return 1;
    })
  ).toBe(1)
  .it("setPulse() with an absolute width is callable")
  .expect(
    (() => {
      const dim = new PWM(PWM_PIN, { periodNs: 20_000_000 });
      dim.setPulse(1_500_000);
      return 1;
    })
  ).toBe(1)
  .it("setPeriod() retimes the channel without crashing")
  .expect(
    (() => {
      const dim = new PWM(PWM_PIN, { periodNs: 20_000_000 });
      dim.setDuty(0.5);
      dim.setPeriod(1_000_000);
      return 1;
    })
  ).toBe(1)

done();
