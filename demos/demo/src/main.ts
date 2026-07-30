// ---------------------------------------------------------------------------
// main.ts — Zephyr blink demo (ESP32-S3)
//
// Demonstrates @typecad/framework-zephyr targeting an ESP32-S3
// (esp32s3_devkitc). Blinks a GPIO pin every 500 ms.
//
// GPIO is lowered through devicetree. The ESP32-S3 splits its GPIO across two
// DT controllers — gpio0 (pins 0–31) and gpio1 (pins 32–48) — so the framework
// resolves each pin to its owning controller and emits the matching
// `DT_NODELABEL(gpio0|gpio1)`. D2 (GPIO2) sits on gpio0.
//
// Wiring: the esp32s3_devkitc onboard RGB LED is a WS2812 (GPIO38), which is
// NOT a plain GPIO LED and cannot be driven by a single gpio_pin_set. For this
// blink demo, connect an external LED + current-limiting resistor (~220Ω)
// between D2 (GPIO2) and GND.
// ---------------------------------------------------------------------------

import { D2 } from '@typecad/board';
import { delay } from '@typecad/hal';

function setup(): void {
  D2.asOutput();
}

function loop(): void {
  D2.high();   // → gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 2, 1)
  delay(500);  // → k_msleep(500)
  D2.low();    // → gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 2, 0)
  delay(500);
}
