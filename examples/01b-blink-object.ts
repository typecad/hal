// ---------------------------------------------------------------------------
// Example 1b — Blink: Object vs Legacy GPIO API
//
// Shows the recommended object-creation pattern alongside the legacy
// direct API for pin configuration and toggling.
// ---------------------------------------------------------------------------

import { HIGH, LED, delay } from '@typecad';

// Recommended pattern: alias-based GPIO usage.
const led = LED.asOutput(HIGH);

// Legacy-compatible API: this also works but is less type-safe.
// LED.output(HIGH);

while (true) {
  led.toggle();
  delay(1000);
}
