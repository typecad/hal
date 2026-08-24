// Multi-peripheral smoke test: ADC read + GPIO + timing.
// Exercises the ADC + GPIO + timing lowering to prove it compiles+links under
// west build. (I2C/UART/PWM use the same bus-state pattern, validated by the
// manifest cross-check; board-package HAL instances for them are a follow-on.)

import { LED, A0 } from '@typecad/board';
import { delay } from '@typecad/hal';

let toggle: number = 0;

LED.asOutput();

while (true) {
  const val: number = A0.read() ? 1 : 0;   // adc.read → SAADC (read() returns boolean)
  if (val) {
    LED.toggle();                          // gpio.toggle → gpio_pin_toggle_dt
  }
  delay(100);                              // timing.delay → k_msleep
  toggle = toggle + 1;
}
