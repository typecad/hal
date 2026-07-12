// ---------------------------------------------------------------------------
// Example 20 — GPIO Object-Creation Pattern
//
// Demonstrates the recommended way to configure GPIO pins using the
// object-creation pattern. Each asOutput()/asInput()/asInputPullUp() call:
//   1. Emits the correct pinMode() in C++
//   2. Optionally sets an initial value (asOutput(HIGH))
//   3. Returns a type-narrowed alias tracked by the transpiler
//
// The alias is zero-cost — no C++ variable is generated. All operations
// on the alias (toggle, read, high, low) emit the same C++ as if you
// used the original pin name.
// ---------------------------------------------------------------------------

import { LED, D2, D3, D9, delay } from '@typecad/board';

// ── Output pins ────────────────────────────────────────────────────────────
// LED.asOutput(true) → pinMode(LED_BUILTIN, OUTPUT) + digitalWrite(LED_BUILTIN, HIGH)
const led = LED.asOutput(true);

// D9.asOutput() → pinMode(9, OUTPUT) — no initial value
const buzzer = D9.asOutput();

// ── Input pins ─────────────────────────────────────────────────────────────
// D2.asInput() → pinMode(2, INPUT)
const button = D2.asInput();

// D3.asInputPullUp() → pinMode(3, INPUT_PULLUP)
const btn2 = D3.asInputPullUp();

// ── Main loop ──────────────────────────────────────────────────────────────
// All operations on aliases emit correct C++ — no pin-mode warnings.
while (true) {
  // Read button (aliased from D2.asInput())
  if (!button.read()) {
    led.toggle();       // alias for LED.toggle()
  }

  // Read second button (aliased from D3.asInputPullUp())
  if (!btn2.read()) {
    buzzer.high();      // alias for D9.high()
  } else {
    buzzer.low();       // alias for D9.low()
  }

  delay(100);
}
