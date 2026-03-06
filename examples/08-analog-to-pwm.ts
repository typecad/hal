// ---------------------------------------------------------------------------
// Example 8 — Analog → PWM mapping
//
// Read a potentiometer on A0 and map its 10-bit value to an 8-bit PWM
// brightness on D9.  Demonstrates the map() and constrain() utilities.
// ---------------------------------------------------------------------------

import { A0, D9, map, constrain, delay, LOW } from '@typecode';

D9.config.output.initial(LOW);

while (true) {
  const raw = A0.read();
  const brightness = constrain(map(raw, 0, 1023, 0, 255), 0, 255);
  D9.write(brightness);
  delay(20);
}