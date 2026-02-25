"use strict";
// ---------------------------------------------------------------------------
// Example 2 — Analog Read → Serial
//
// Read a potentiometer on A0 and print the value over serial at 9600 baud.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const pins_1 = require("../code/board-arduino-uno/pins");
const peripherals_1 = require("../code/board-arduino-uno/peripherals");
const timing_1 = require("../code/board-arduino-uno/timing");
peripherals_1.Serial.initialize({ baudRate: 9600 });
while (true) {
    const value = pins_1.A0.read();
    peripherals_1.Serial.println(value);
    (0, timing_1.delay)(500);
}
