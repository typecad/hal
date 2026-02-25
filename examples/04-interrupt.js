"use strict";
// ---------------------------------------------------------------------------
// Example 4 — External Interrupt (Button Toggle)
//
// A button on D2 (with internal pull-up) toggles the onboard LED.
// D2 is typed as IDigitalPin & IInterruptPin, so attachInterrupt is valid.
// Trying this on D4 (IDigitalPin only) would be a compile error.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const pins_1 = require("../code/board-arduino-uno/pins");
const core_1 = require("../code/core");
pins_1.LED.asOutput();
pins_1.D2.asInputPullUp();
let ledState = false;
pins_1.D2.attachInterrupt(() => {
    ledState = !ledState;
    if (ledState) {
        pins_1.LED.high();
    }
    else {
        pins_1.LED.low();
    }
}, core_1.InterruptMode.FALLING);
