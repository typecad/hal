import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles pwm, pwmAlt
// Servo rides the PWM silicon routes (a servo IS a calibrated 50 Hz PWM
// channel), so the pwm role's pads exercise it. The clamping and angle→
// pulse mapping run in the lowered C++ — these prove the verbs construct
// and drive without trapping, and that two calibrated channels coexist.
import { PWM_PIN, PWM_ALT } from '@typecad/test-pins';
import { Servo } from '@typecad/hal';

describe("Servo construction and travel")
  .it("Servo(pin) with default calibration configures without crashing")
  .expect(
    (() => {
      const pan = new Servo(PWM_PIN);
      pan.writeAngle(0);
      pan.writeAngle(180);
      return 1;
    })
  ).toBe(1)
  .it("a calibrated servo sweeps its range and idles")
  .expect(
    (() => {
      const tilt = new Servo(PWM_PIN, { minUs: 500, maxUs: 2500, maxAngle: 270 });
      tilt.writeAngle(135);
      tilt.writeUs(1500);
      tilt.writeUs(0); // clamps to minUs — never a damaging pulse
      tilt.idle();
      return 1;
    })
  ).toBe(1)
  .it("a second servo on another pad coexists")
  .expect(
    (() => {
      const a = new Servo(PWM_PIN);
      const b = new Servo(PWM_ALT);
      a.writeAngle(45);
      b.writeAngle(90);
      return 1;
    })
  ).toBe(1)

done();
