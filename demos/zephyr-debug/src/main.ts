// ---------------------------------------------------------------------------
// Blink — The classic "Hello World" of embedded
//
// Toggles the onboard LED every second using the recommended GPIO pattern.
// ---------------------------------------------------------------------------

import { LED, delay } from '@typecad/board';

const led = LED.asOutput(false);

while (true) {
  led.toggle();
  delay(1000);
}
