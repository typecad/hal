// ---------------------------------------------------------------------------
// Example 6 — SPI Shift Register
//
// Drive a 74HC595 shift register over SPI with a rotating bit pattern.
// ---------------------------------------------------------------------------

import { SPI0, SS, delay } from '@typecad/board';

const spi = SPI0.begin();
spi.setFrequency(1_000_000);
SS.asOutput(false);

let pattern = 0b00000001;

while (true) {
  spi.device(SS).write(pattern);

  // rotate left
  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
  delay(200);
}
