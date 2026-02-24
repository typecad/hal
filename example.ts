// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------

import { LED }   from './code/board-arduino-uno/pins';
import { delay } from './code/board-arduino-uno/timing';

LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
