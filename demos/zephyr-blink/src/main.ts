// ---------------------------------------------------------------------------
// main.ts — Zephyr blink demo (thin HAL: GPIO + Time)
//
// Blinks the onboard user LED. The LED is active-low on the XIAO nRF52840,
// but GPIO lowers via devicetree specs (gpio_pin_set_dt), which honor the
// node's GPIO_ACTIVE_LOW flag — so set(true) turns the LED ON. Construction
// flags are Zephyr's names; Time.sleep is the TS-flavored replacement for
// delay() (same k_msleep underneath).
//
// Top-level statements lower straight into main(); the explicit while (true)
// is the program's loop (the shape `cuttlefish create` scaffolds).
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.set(true);   // → gpio_pin_set_dt(&__tc_dt_led0, 1) → LED ON
  Time.sleep(500); // → k_msleep(500)
  led.set(false);  // → gpio_pin_set_dt(&__tc_dt_led0, 0) → LED OFF
  Time.sleep(500);
}
