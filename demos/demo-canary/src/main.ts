// ---------------------------------------------------------------------------
// main.ts — the multi-module compile canary: GPIO + timing + cross-module
// imports, lowered and west-compiled on native_sim by CI. Kept deliberately
// trivial; its job is to break the build when the general lowering breaks,
// not to demonstrate features.
// ---------------------------------------------------------------------------

import { LED, GPIO, Time } from '@typecad/hal';
import { BLINK_PATTERN_MS, patternPeriodMs, stepDurationMs } from './pattern.js';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  for (let i = 0; i < BLINK_PATTERN_MS.length; i++) {
    led.set(i % 2 === 0);
    Time.sleep(stepDurationMs(BLINK_PATTERN_MS, i));
  }
  // Quarter-period dark gap between passes — keeps patternPeriodMs live.
  led.set(false);
  Time.sleep(patternPeriodMs(BLINK_PATTERN_MS) / 4);
}
