// Multi-peripheral smoke test: ADC read + GPIO + timing.
// Exercises the ADC + GPIO + timing lowering to prove it compiles+links under
// west build. (I2C/UART/PWM use the same bus-state pattern, validated by the
// manifest cross-check; board-package HAL instances for them are a follow-on.)

import { LED, P0_02, GPIO, ADC, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);
const sense = new ADC(P0_02);

let toggle: number = 0;

while (true) {
  const val: number = sense.read() ? 1 : 0;  // adc read_raw → SAADC
  if (val) {
    led.toggle();                            // gpio_pin_toggle_dt
  }
  Time.sleep(100);                           // k_msleep
  toggle = toggle + 1;
}
