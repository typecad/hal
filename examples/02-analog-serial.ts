// ---------------------------------------------------------------------------
// Example 2 — Analog Read → Serial (Arduino-Compatible)
//
// Read a potentiometer on A0 and print the value over serial at 9600 baud.
// Uses Arduino-compatible API style.
// ---------------------------------------------------------------------------

import { A0 } from '@typecode/board-arduino-uno';
import { UART0 } from '@typecode/board-arduino-uno/arduino';
import { delay } from '@typecode/board-arduino-uno';

UART0.begin(9600);

while (true) {
  const value = A0.read();
  UART0.println(value);
  delay(500);
}