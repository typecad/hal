"use strict";
// ---------------------------------------------------------------------------
// Example 8 — Analog → PWM mapping
//
// Read a potentiometer on A0 and map its 10-bit value to an 8-bit PWM
// brightness on D9.  Demonstrates the map() and constrain() utilities.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const pins_1 = require("../code/board-arduino-uno/pins");
const timing_1 = require("../code/board-arduino-uno/timing");
const timing_2 = require("../code/board-arduino-uno/timing");
pins_1.D9.asOutput();
while (true) {
    const raw = pins_1.A0.read();
    const brightness = (0, timing_1.constrain)((0, timing_1.map)(raw, 0, 1023, 0, 255), 0, 255);
    pins_1.D9.write(brightness);
    (0, timing_2.delay)(20);
}
