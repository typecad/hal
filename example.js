"use strict";
// ---------------------------------------------------------------------------
// Example 1 — Blink
//
// The classic "Hello World" of embedded: toggle the onboard LED every second.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const board_arduino_uno_1 = require("@typecode/board-arduino-uno");
board_arduino_uno_1.LED.asOutput();
while (true) {
    board_arduino_uno_1.LED.toggle();
    (0, board_arduino_uno_1.delay)(1000);
}
