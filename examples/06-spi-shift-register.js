"use strict";
// ---------------------------------------------------------------------------
// Example 6 — SPI Shift Register
//
// Drive a 74HC595 shift register over SPI with a rotating bit pattern.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const peripherals_1 = require("../code/board-arduino-uno/peripherals");
const pins_1 = require("../code/board-arduino-uno/pins");
const timing_1 = require("../code/board-arduino-uno/timing");
peripherals_1.SPI0.initialize({ frequency: 1_000_000 });
pins_1.SS.asOutput();
let pattern = 0b00000001;
while (true) {
    pins_1.SS.low();
    peripherals_1.SPI0.write(new Uint8Array([pattern]));
    pins_1.SS.high();
    // rotate left
    pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
    (0, timing_1.delay)(200);
}
