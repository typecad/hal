// ---------------------------------------------------------------------------
// Blink — The classic "Hello World" of embedded
//
// Toggles GPIO2 every second using the thin HAL: construction
// flags configure the pin, Time.sleep is the TS-flavored replacement for
// delay() (same k_msleep underneath).
// ---------------------------------------------------------------------------

import { GPIO2 } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(GPIO2, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
