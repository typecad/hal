"use strict";
// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const pins_1 = require("../code/board-arduino-uno/pins");
const timing_1 = require("../code/board-arduino-uno/timing");
pins_1.LED.asOutput();
while (true) {
    pins_1.LED.toggle();
    (0, timing_1.delay)(1000);
}
