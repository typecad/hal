// ---------------------------------------------------------------------------
// Example 4 — External Interrupt (Button Toggle)
//
// A button on D2 (with internal pull-up) toggles the onboard LED.
// D2 is typed as IDigitalPin & IInterruptPin, so attachInterrupt is valid.
// Trying this on D4 (IDigitalPin only) would be a compile error.
// ---------------------------------------------------------------------------

import { D2, LED, LOW } from '@typecode';

LED.config.output.initial(LOW);
D2.config.input.pullup();

let ledState = false;

D2.on.falling(() => {
  ledState = !ledState;
  if (ledState) {
    LED.high();
  } else {
    LED.low();
  }
});