// ---------------------------------------------------------------------------
// Example 8 — Analog → PWM mapping
//
// Read a potentiometer on A0 and map its 10-bit value to an 8-bit PWM
// brightness on D9.  Demonstrates the map() and constrain() utilities.
// ---------------------------------------------------------------------------

import { A0, D9 } from '../code/board-arduino-uno/pins';
import { map, constrain } from '../code/board-arduino-uno/timing';
import { delay } from '../code/board-arduino-uno/timing';

D9.asOutput();

while (true) {
  const raw = A0.read();
  const brightness = constrain(map(raw, 0, 1023, 0, 255), 0, 255);
  D9.write(brightness);
  delay(20);
}
