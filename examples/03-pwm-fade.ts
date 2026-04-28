// ---------------------------------------------------------------------------
// Example 3 — PWM Fade
//
// Smoothly fade an LED on PWM pin D9.
// D9 has PWM capability so .pwm() is available.
// A non-PWM pin like D4 would produce a compile error.
// ---------------------------------------------------------------------------

import { D9, delay } from '@typehal';

D9.asOutput(false);

let brightness = 0;
let step = 5;

while (true) {
  D9.pwm(brightness / 2.55); // Convert 0-255 to 0-100 percent
  brightness += step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}