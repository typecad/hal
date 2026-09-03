// ---------------------------------------------------------------------------
// blink.ts — the minimal baseline canary.
//
// GPIO + timing only. Boards that fail this one have a fundamental problem
// (no LED fact in their devicetree record, or a broken GPIO lowering) — if
// this passes but universal-peripherals.ts fails, the gap is in a specific
// peripheral's lowering.
// ---------------------------------------------------------------------------

import { GPIO, Time } from '@typecad/hal';
import { LED } from '@typecad/board';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
