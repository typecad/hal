// ---------------------------------------------------------------------------
// Example 2 — Analog Read → Serial
//
// Read a potentiometer on A0 and print the value over serial at 9600 baud.
// ---------------------------------------------------------------------------

import { A0 }     from '../code/board-arduino-uno/pins';
import { Serial } from '../code/board-arduino-uno/peripherals';
import { delay }  from '../code/board-arduino-uno/timing';

Serial.initialize({ baudRate: 9600 });

while (true) {
  const value = A0.read();
  Serial.println(value);
  delay(500);
}
