// ---------------------------------------------------------------------------
// Example 2 — Analog Read → Serial (Arduino-Compatible)
//
// Read a potentiometer on A0 and print the value over serial at 9600 baud.
// Uses Arduino-compatible API style.
// ---------------------------------------------------------------------------

import { A0, UART0, delay } from '@typehal';

const serial = UART0.begin(9600);
A0.asInput()

while (true) {
  serial.println(`A0: ${A0.readAnalog()}`);
  delay(500);
}
