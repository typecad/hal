// ---------------------------------------------------------------------------
// Example 2 — Analog Read → Serial (Arduino-Compatible)
//
// Read a potentiometer on A0 and print the value over serial at 9600 baud.
// Uses Arduino-compatible API style.
// ---------------------------------------------------------------------------

import { A0, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

while (true) {
  const value = A0.read();
  UART0.write.line(value.toString());
  delay(500);
}