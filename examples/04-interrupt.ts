// ---------------------------------------------------------------------------
// Example 4 — External Interrupt (Button Toggle)
//
// A button on D2 (with internal pull-up) toggles the onboard LED.
// D2 is typed as IDigitalPin & IInterruptPin, so attachInterrupt is valid.
// Trying this on D4 (IDigitalPin only) would be a compile error.
// ---------------------------------------------------------------------------

import { D2, LED } from '../code/board-arduino-uno/pins';
import { InterruptMode } from '../code/core';

LED.asOutput();
D2.asInputPullUp();

let ledState = false;

D2.attachInterrupt(() => {
  ledState = !ledState;
  if (ledState) {
    LED.high();
  } else {
    LED.low();
  }
}, InterruptMode.FALLING);
