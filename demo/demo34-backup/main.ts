// ---------------------------------------------------------------------------
// main.ts — Blink the on-board LED while sampling an analog input
//                                  (cuttlefish demo #34, Arduino AVR target).
//
// The FIRST demo to exercise the TypeCAD HAL end-to-end on real hardware.
// It configures a digital output (the on-board LED) and an analog input (A0),
// then in a steady loop it blinks the LED, reads A0 once, and prints the raw
// count + computed voltage to Serial.
//
// This is written in its NATURAL, idiomatic TypeScript form. An earlier
// iteration carried four workarounds for transpiler bugs (demo #34 Findings
// A–D); all four are now FIXED in the transpiler, so the workarounds are gone:
//
//   • Finding B (fixed): `const raw = adc.readAnalog()` is now stored ONCE and
//     reused — the read is captured into a real `auto raw = analogRead(14)`
//     and `raw` is referenced at every use site (it no longer collapses to the
//     pin number). Single ADC conversion per loop.
//   • Finding C (fixed): LED drive is factored into a helper function
//     `toggleLed()` declared BEFORE the `const led` pin alias. HAL resolution
//     is now order-independent (lazy top-level alias resolution), so the
//     helper's `led.high()`/`led.low()` inline to `digitalWrite(13, ...)` no
//     matter where the function sits.
//   • Finding D (fixed): the LED-state ternary is used INLINE in the string
//     concat (`'led=' + (ledOn ? 'on ' : 'off')`) — a ternary of two string
//     literals now infers `const char*` and is no longer wrapped in an invalid
//     `.c_str()`.
//   • Finding A (the rule stands, by design): owned blink state stays a
//     MODULE-LEVEL scalar (`let ledOn`), not a `new Blinker()` class instance.
//     AVR has no heap manager, so `new` on AVR is correctly rejected
//     (`heap-allocation-avr`) — now detected consistently regardless of
//     imports. A module-level scalar is the genuinely AVR-correct shape for
//     one bit of owned state, independent of the gate.
//
// AVR (ATmega328P, 2KB RAM, no `<vector>`, no heap, 10-bit ADC) and the HAL
// lowering lower this to exactly what you'd hand-write:
//     LED.asOutput()    → pinMode(13, OUTPUT);
//     led.high()/low()  → digitalWrite(13, HIGH / LOW);
//     A0.asInput()      → pinMode(14, INPUT);
//     adc.readAnalog()  → analogRead(14)
// No class is emitted for the pins.
//
// Idiomatic constraints honored (per SUPPORT_MATRIX / eslint rules): only
// `const enum`; no `any`; no typed-array fields/returns; no object spread; no
// `instanceof`; no `String.*`/`Number.*` statics; and (AVR-specific) no
// dynamically-grown array fields/params/returns and no heap `new`.
// ---------------------------------------------------------------------------

import { LED, A0 } from '@typecad/board-arduino-uno';

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// The LED blink interval and the inter-sample delay share one period: the LED
// toggles, then we wait, then we sample. A half-second cadence keeps the blink
// visible to the eye and the serial output readable.
const BLINK_PERIOD_MS: int32_t = 500;

// ADC reference for the Arduino Uno is the supply rail (DEFAULT ≈ 5 V), and the
// ADC is 10-bit, so the full-scale count is 1023. Used to turn a raw count into
// a millivolt figure with plain integer math (see `toMillivolts`).
const ADC_MAX: int32_t = 1023;
const VREF_MILLIVOLTS: int32_t = 5000;

// ---------------------------------------------------------------------------
// Records.
// ---------------------------------------------------------------------------

// One sampled reading: the raw ADC count and the derived voltage in
// millivolts. A plain `interface` lowers to a POD C++ struct returned by value.
interface Reading {
  raw: int32_t;
  millivolts: int32_t;
}

// ---------------------------------------------------------------------------
// Owned blink state. A single module-level boolean — the AVR-idiomatic shape
// for one bit of owned mutable state (no `new`, no heap; see file header).
// ---------------------------------------------------------------------------

let ledOn: boolean = false;

// ---------------------------------------------------------------------------
// Pure / pin helpers. `toggleLed` references the top-level `led` pin alias;
// HAL resolution is order-independent (Finding C fix) so it inlines correctly
// even though it is declared before `const led`.
// ---------------------------------------------------------------------------

// Convert a raw ADC count (0..ADC_MAX) into millivolts (0..VREF_MILLIVOLTS)
// with plain integer math. Millivolts (not volts) avoids floating point
// entirely, which is cheaper on AVR and prints cleanly via `Serial`.
function toMillivolts(raw: int32_t): int32_t {
  if (raw < 0) {
    return 0;
  }
  if (raw > ADC_MAX) {
    return VREF_MILLIVOLTS;
  }
  return raw * VREF_MILLIVOLTS / ADC_MAX;
}

// Toggle the on-board LED and return whether it is now lit. `led.high()`/
// `led.low()` inline to `digitalWrite(13, HIGH/LOW)`.
function toggleLed(): boolean {
  ledOn = !ledOn;
  if (ledOn) {
    led.high();
  } else {
    led.low();
  }
  return ledOn;
}

// Build a one-line report for a blink state + a reading. Built by STRING
// CONCATENATION (the inline ternary of two string literals is fine post-
// Finding D). No growable array storage is required.
function report(ledOn: boolean, r: Reading): string {
  let line: string = '';
  line = line + 'led=' + (ledOn ? 'on ' : 'off');
  line = line + ' adc=' + r.raw;
  line = line + ' mV=' + r.millivolts;
  return line;
}

// ---------------------------------------------------------------------------
// Configure the pins once. These top-level calls run in the auto-generated
// `setup()` and lower to `pinMode(13, OUTPUT)` / `pinMode(14, INPUT)`.
// ---------------------------------------------------------------------------

const led = LED.asOutput();
const adc = A0.asInput();

// ---------------------------------------------------------------------------
// Periodic work. Toggle the LED, read A0 ONCE (Finding B fix — the read is
// captured into `raw` and reused, a single ADC conversion per loop), print the
// report, wait. The `while (true)` loop is the natural Arduino shape for "do
// this forever" and keeps the auto-generated `loop()` empty.
// ---------------------------------------------------------------------------

console.log('--- blink + ADC demo ---');

while (true) {
  const on: boolean = toggleLed();
  const raw: int32_t = adc.readAnalog();
  const reading: Reading = { raw: raw, millivolts: toMillivolts(raw) };
  console.log(report(on, reading));
  Timing.delay(BLINK_PERIOD_MS);
}
