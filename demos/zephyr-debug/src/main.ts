// ---------------------------------------------------------------------------
// Blink — The classic "Hello World" of embedded
//
// Toggles the onboard LED every second using the thin HAL: construction
// flags configure the pin, Time.sleep is the TS-flavored replacement for
// delay() (same k_msleep underneath).
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
