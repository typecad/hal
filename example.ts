// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------

import { Board, delay } from '@typecode/board-arduino-uno';

Board.LED.asOutput();

async function blinkLed() {
  while (true) {
    Board.LED.high();
    await delay(500);
    Board.LED.low();
    await delay(500);
  }
}

blinkLed();
