// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// Uses the object-creation pattern: LED.asOutput() configures pinMode AND
// returns a type-narrowed alias for subsequent calls.
// ---------------------------------------------------------------------------

import { HIGH, LED, delay } from '@typecad/board';

const led = LED.asOutput(HIGH);

while (true) {
  led.toggle();
  delay(1000);
}
