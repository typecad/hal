// ---------------------------------------------------------------------------
// Example 1b — Blink: Object-Creation Pattern vs. Direct API
//
// Shows both GPIO access patterns side-by-side. Both produce identical C++.
//
// Pattern A (direct):  LED.output(); LED.toggle();
//   - Two separate calls: one for mode, one for I/O
//   - Pin-mode validation warns if you forget .output()
//
// Pattern B (object):  const led = LED.asOutput(); led.toggle();
//   - Single call configures mode AND returns a type-narrowed alias
//   - Compiler enforces correct mode at the type level
//   - No C++ variable is emitted — 'led' is a zero-cost alias
// ---------------------------------------------------------------------------

import { HIGH, LED, delay } from '@typecode';

// ── Pattern A: Direct API (original) ──────────────────────────────────────
// LED.output(HIGH);          // pinMode + implicit mode tracking
// while (true) {
//   LED.toggle();            // digitalWrite(LED_BUILTIN, !digitalRead(...))
//   delay(1000);
// }

// ── Pattern B: Object-Creation (recommended) ─────────────────────────────
// asOutput() emits pinMode(LED_BUILTIN, OUTPUT) and optionally digitalWrite
// for the initial value. The returned 'led' is tracked as an alias for LED,
// so led.toggle() emits the same C++ as LED.toggle().

const led = LED.asOutput(HIGH);

while (true) {
  led.toggle();
  delay(1000);
}
