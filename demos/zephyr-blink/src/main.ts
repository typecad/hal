// ---------------------------------------------------------------------------
// main.ts — Zephyr blink demo
//
// Blinks the onboard user LED. The LED is active-low on the XIAO nRF52840,
// but the framework lowers GPIO via devicetree specs (gpio_pin_set_dt), which
// honor the node's GPIO_ACTIVE_LOW flag — so .high() turns the LED ON.
//
// Top-level statements lower straight into main(); the explicit while (true)
// is the program's loop (the shape `cuttlefish create` scaffolds).
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board';
import { delay } from '@typecad/hal';

LED.asOutput();

while (true) {
  LED.high();    // → gpio_pin_set_dt(&__tc_dt_led0, 1) → LED ON
  delay(500);    // → k_msleep(500)
  LED.low();     // → gpio_pin_set_dt(&__tc_dt_led0, 0) → LED OFF
  delay(500);
}
