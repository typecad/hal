// ---------------------------------------------------------------------------
// Example 3 — PWM Fade
//
// Smoothly fade an LED on PWM pin D9.
// D9 is typed as IPWMPin, so .write() and .pwm() are available.
// A non-PWM pin like D4 would produce a compile error.
// ---------------------------------------------------------------------------

import { D9, delay, LOW } from '@typecode';

D9.config.output.initial(LOW);

let brightness = 0;
let step = 5;

while (true) {
  D9.write(brightness);
  brightness += step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}