"use strict";
// ---------------------------------------------------------------------------
// Example 3 — PWM Fade
//
// Smoothly fade an LED on PWM pin D9.
// D9 is typed as IPWMPin, so .write() and .setDutyCycle() are available.
// A non-PWM pin like D4 would produce a compile error.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const pins_1 = require("../code/board-arduino-uno/pins");
const timing_1 = require("../code/board-arduino-uno/timing");
pins_1.D9.asOutput();
let brightness = 0;
let step = 5;
while (true) {
    pins_1.D9.write(brightness);
    brightness += step;
    if (brightness <= 0 || brightness >= 255) {
        step = -step;
    }
    (0, timing_1.delay)(30);
}
