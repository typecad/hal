// Minimal blink program used by e2e-compile.test.ts.
// The transpiler lowers these @typecad/hal calls into HAL ops that
// framework-esp32 resolves to native ESP-IDF driver calls.
import { OutputPin } from '@typecad/hal';
import { Timing } from '@typecad/hal';

const led = new OutputPin(2);
let on = false;

export function setup() {}
export function loop() {
  on = !on;
  led.write(on ? 1 : 0);
  Timing.delay(500);
}

console.log('blink starting');
