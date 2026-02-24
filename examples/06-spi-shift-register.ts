// ---------------------------------------------------------------------------
// Example 6 — SPI Shift Register
//
// Drive a 74HC595 shift register over SPI with a rotating bit pattern.
// ---------------------------------------------------------------------------

import { SPI0 }  from '../code/board-arduino-uno/peripherals';
import { SS }    from '../code/board-arduino-uno/pins';
import { delay } from '../code/board-arduino-uno/timing';

SPI0.initialize({ frequency: 1_000_000 });
SS.asOutput();

let pattern = 0b00000001;

while (true) {
  SS.low();
  SPI0.write(new Uint8Array([pattern]));
  SS.high();

  // rotate left
  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
  delay(200);
}
