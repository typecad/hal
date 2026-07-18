import { D2 } from '@typecad/board-esp32s3';
import { Timing } from '@typecad/hal';

const led = D2.asOutput();

// In loop — toggle the LED with a delay so the watchdog doesn't fire.
// (framework-esp32's __tc_app_task calls loop() repeatedly; no while(true)
// needed at the top level.)
export function loop() {
  led.toggle();
  Timing.delay(500);
}
