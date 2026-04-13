// ---------------------------------------------------------------------------
// Example 4 — External Interrupt (Button Toggle)
//
// A button on D2 (with internal pull-up) toggles the onboard LED.
// D2 has interrupt capability so .onFalling() is available.
// Trying this on D4 would produce a compile error.
//
// Uses the object-creation pattern: asOutput()/asInputPullUp() configure
// pinMode AND return type-narrowed aliases for subsequent calls.
// ---------------------------------------------------------------------------

import { D2, LED } from '@typecode';

const led = LED.asOutput(false);
const btn = D2.asInputPullUp();

let ledState = false;

D2.onFalling(() => {
  ledState = !ledState;
  if (ledState) {
    led.high();
  } else {
    led.low();
  }
});