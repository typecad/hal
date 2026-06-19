// ---------------------------------------------------------------------------
// main.ts — Blink the on-board LED while sampling an analog input
//                                  (cuttlefish demo #34, Arduino AVR target).
//
// The FIRST demo to exercise the TypeCAD HAL end-to-end on real hardware.
// Every prior demo (#1–#32 native g++, #33 AVR pure-compute) kept to in-process
// computation; this one reaches the silicon: it configures a digital output
// (the on-board LED) and an analog input (A0), then in a steady loop it blinks
// the LED, reads A0, and prints the raw count + computed voltage to Serial.
//
// AVR (ATmega328P, 2KB RAM, no `<vector>`, no heap, 10-bit ADC) and the HAL
// lowering together shape the program in several specific ways. Three of them
// are transpiler gaps this demo surfaced (full write-up in the README):
//
//   • The on-board LED and A0 come from `@typecad/board-arduino-uno` as typed
//     `Pin` instances. The transpiler INLINES pin method calls into direct
//     Arduino C++ at compile time — but ONLY at the top level (which flows
//     into `setup()`). A pin method call from INSIDE a function is NOT
//     inlined (Finding C: the pin variable is substituted to its numeric pin
//     at the declaration site and no longer exists for a later method call).
//     Therefore ALL pin I/O in this demo happens at the top level, and the
//     helpers (`toMillivolts`, `formatState`, `report`) are PURE computation.
//
//   • Finding B (correctness): the return value of a pin method call MUST be
//     used INLINE at the point of call. Storing it in a variable
//     (`const raw = adc.readAnalog()`) and referencing that variable later is
//     MISCOMPILED — the pin-substitution pass replaces every later use of the
//     variable with the pin's NUMBER (e.g. `raw` → `14`), and the actual
//     `analogRead(14)` call is dropped. So `adc.readAnalog()` is called inline
//     twice per loop here (once for the raw count, once for the millivolt
//     conversion) rather than stored. Two ADC conversions per blink is
//     harmless for a demo; the README notes the proper fix.
//
//   • Owned mutable state (the blink on/off flag) is a MODULE-LEVEL scalar
//     (`let ledOn`), NOT a class instance. AVR has no heap manager, so a
//     `new Blinker()` is rejected by the `heap-allocation-avr` gate — and the
//     gate's coverage is itself inconsistent (Finding A: it fires only when a
//     HAL/board `import` is present). A module-level scalar sidesteps both.
//
//   • Finding D: an INLINE ternary of two string literals used directly as a
//     `+` operand mis-infers as `std::string` and emits an invalid `.c_str()`
//     call. Assigning the ternary to a typed `const state: string` first
//     resolves the type correctly (see `formatState`).
//
// At the top level the lowering is exactly what you'd hand-write:
//     LED.asOutput()   → pinMode(13, OUTPUT);
//     led.high()/low() → digitalWrite(13, HIGH / LOW);
//     A0.asInput()     → pinMode(14, INPUT);
//     adc.readAnalog() → analogRead(14)
// No class is emitted for the pins.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object
// spread; no `instanceof`; no `keyof`/conditional/mapped types; no
// `String.*`/`Number.*` statics (§5.4); no `delete` on non-Map collections;
// no comparing a `Map.get()` result to `undefined`; and (AVR-specific) no
// dynamically-grown array fields/params/returns (§1.5 AVR note) and no heap
// allocation via `new` (heap-allocation-avr).
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
// millivolts. A plain `interface` lowers to a POD C++ struct. NOTE: a function
// RETURNING this struct is fine; what is NOT fine (Finding B) is building it
// from a stored pin-method return value. Here it is built and consumed inline
// in the loop, so it is safe.
interface Reading {
  raw: int32_t;
  millivolts: int32_t;
}

// ---------------------------------------------------------------------------
// Pure helpers (no pin I/O — see file header). These are safe to factor into
// functions because they touch only their arguments.
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

// Render the LED state as a short tag. The ternary is assigned to a typed
// `const state: string` FIRST because using an inline ternary of two string
// literals directly as a `+` operand triggers Finding D (an invalid `.c_str()`
// call on a `const char*`).
function formatState(ledOn: boolean): string {
  const state: string = ledOn ? 'on ' : 'off';
  return state;
}

// Build a one-line report for a blink state + a reading. Built by STRING
// CONCATENATION so no growable array storage is required.
function report(state: string, r: Reading): string {
  let line: string = '';
  line = line + 'led=' + state;
  line = line + ' adc=' + r.raw;
  line = line + ' mV=' + r.millivolts;
  return line;
}

// ---------------------------------------------------------------------------
// Owned blink state. A single module-level boolean — the AVR-idiomatic shape
// for one bit of owned mutable state (no `new`, no heap).
// ---------------------------------------------------------------------------

let ledOn: boolean = false;

// ---------------------------------------------------------------------------
// Configure the pins once. These top-level calls run in the auto-generated
// `setup()` and lower to `pinMode(13, OUTPUT)` / `pinMode(14, INPUT)`.
// ---------------------------------------------------------------------------

const led = LED.asOutput();
const adc = A0.asInput();

// ---------------------------------------------------------------------------
// Periodic work, ALL at the top level so every pin call inlines. Toggle the
// LED, read A0, print the report, wait. The `while (true)` loop is the natural
// Arduino shape for "do this forever" and keeps the auto-generated `loop()`
// empty.
//
// Per Finding B, `adc.readAnalog()` is called INLINE twice (once for the raw
// count line, once to build the Reading). It cannot be stored in a variable.
// ---------------------------------------------------------------------------

console.log('--- blink + ADC demo ---');

while (true) {
  ledOn = !ledOn;
  if (ledOn) {
    led.high();
  } else {
    led.low();
  }
  const reading: Reading = {
    raw: adc.readAnalog(),
    millivolts: toMillivolts(adc.readAnalog()),
  };
  console.log(report(formatState(ledOn), reading));
  Timing.delay(BLINK_PERIOD_MS);
}
