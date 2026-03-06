// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------

import { LED, delay, HIGH } from '@typecode';

LED.config.output.initial(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
