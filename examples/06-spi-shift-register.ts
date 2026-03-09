// ---------------------------------------------------------------------------
// Example 6 — SPI Shift Register
//
// Drive a 74HC595 shift register over SPI with a rotating bit pattern.
// ---------------------------------------------------------------------------

import { SPI0, SS, delay, LOW } from '@typecode';

SPI0.config.frequency(1_000_000).begin();
SS.config.output.initial(LOW);

let pattern = 0b00000001;

while (true) {
  SPI0.device(SS).write(pattern);

  // rotate left
  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
  delay(200);
}