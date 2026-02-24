// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------

import { LED, delay } from '@typecode/board-arduino-uno';

LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
