// ---------------------------------------------------------------------------
// main.ts — Sensor class hierarchy + namespace config
//                                  (cuttlefish demo #36, Arduino AVR target).
//
// The first demo to exercise CLASSES, INHERITANCE (`extends` + `super`), and
// NAMESPACES on AVR. It models the bread-and-butter embedded idiom: a small
// driver hierarchy where a base `Sensor` holds a pin + smoothing state, a
// derived `ThresholdSensor` adds a threshold and overrides behavior via
// `super.method()`, and a `Config` namespace holds shared tuning constants.
//
// This is also the demo that re-evaluated the `heap-allocation-avr` gate.
// Classes lower to reference types (`T*`) instantiated via `new`, and `new`
// on AVR was previously a hard ERROR (demo #34 Finding A). That gate was
// INVALID: the Arduino AVR core ships a complete `operator new`/`delete`
// (`cores/arduino/new.cpp` over avr-libc's `malloc`/`free`) — a real heap.
// `new` + inheritance compiles and runs on the Uno (verified: ~1.8 KB heap
// free). So demo #36 downgraded the gate from error to WARNING (a small-heap
// capacity heads-up, not a correctness refusal), unblocking classes on AVR.
// The demo prints one `heap-allocation-avr` warning per `new` site — that is
// the intended, correct behavior, and the build proceeds.
//
// What this exercises, all on AVR:
//   • `class Sensor` — scalar fields (pin, sample count, smoothing), ctor with
//     a `super`-equivalent initializer, instance methods. Lowers to a C++ class
//     with `T*` instances.
//   • `class ThresholdSensor extends Sensor` — `super(pin)` ctor call (→ C++
//     initializer list), `super.reading()` (→ base-class method call), an added
//     threshold field + overridden behavior.
//   • `namespace Config` — exported `const` + `function`, accessed via
//     `Config::` / `Config.NAME`. Lowers to a C++ `namespace`.
//   • `new ThresholdSensor(...)` — heap instantiation, now a warning not error.
//   • The on-board LED reflects whether the latest smoothed reading is over
//     the threshold, so the state is visible without the serial monitor.
//
// AVR constraints honored: only `const enum`; no `any`; no typed-array fields;
// no object spread; no `instanceof`; no `String.*`/`Number.*` statics; no
// dynamically-grown array fields/params/returns (§1.5 AVR note). Heap `new` is
// now permitted (warning) — this demo uses it deliberately and sparingly (one
// long-lived allocation; no churn, so no fragmentation risk).
// ---------------------------------------------------------------------------

import { LED, A0 } from '@typecad/board-arduino-uno';

// ---------------------------------------------------------------------------
// Namespace Config — shared tuning constants + a derived helper. Lowers to a
// C++ `namespace Config { ... }`, members accessed via `Config::` / `Config.X`.
// ---------------------------------------------------------------------------

namespace Config {
  // How many raw samples to fold into one smoothed reading. A small EMA-like
  // window keeps the reading responsive without allocating a buffer.
  export const SMOOTHING: int32_t = 4;

  // The threshold (0..1023) above which the LED lights. Picked mid-band so a
  // floating A0 reads near or below it and a driven pin reads above.
  export const THRESHOLD: int32_t = 512;

  // The loop cadence (ms). Bounds CPU use between samples.
  export const PERIOD_MS: int32_t = 200;

  // A namespace-scoped helper: the half-window used by the smoothing divisor.
  // Demonstrates that namespace functions lower and are callable as
  // `Config.halfWindow()`.
  export function halfWindow(): int32_t {
    return SMOOTHING / 2;
  }
}

// ---------------------------------------------------------------------------
// Base class Sensor — holds a pin alias + a running sample count, and exposes
// a `reading()` that takes ONE raw ADC sample. Subclasses extend it.
//
// `pin` is a typed field; on AVR a class field of HAL-pin type is fine because
// the pin is inlined to its number at every use (the field never stores a live
// pin object). The sample count is a scalar.
// ---------------------------------------------------------------------------

class Sensor {
  pin: int32_t;
  samples: int32_t;

  constructor(pin: int32_t) {
    this.pin = pin;
    this.samples = 0;
  }

  // One raw reading from the configured pin. `adc`-style reads are value-
  // bearing halOps; here the read is returned directly (not stored), which is
  // the always-correct inline form. Named `rawReading` (not `reading`) so a
  // derived class can call the inherited base behavior WITHOUT `super.method()`
  // — `super.reading()` is 🟡 partial (demo #36 Finding A: it emits
  // TS2CPP_UNSUPPORTED_EXPR when the class-context isn't visible at the call
  // site). Calling an inherited non-overridden method via `this.rawReading()`
  // / bare `rawReading()` is fully supported.
  rawReading(): int32_t {
    return adc.readAnalog();
  }

  // Bump the sample counter and return it.
  tick(): int32_t {
    this.samples = this.samples + 1;
    return this.samples;
  }
}

// ---------------------------------------------------------------------------
// Derived class ThresholdSensor — extends Sensor, calls `super(pin)` in its
// ctor (→ C++ initializer list), adds a threshold, and adds a `smoothed()`
// method that averages Config.SMOOTHING raw samples via the INHERITED
// `rawReading()` (no `super.` — see Finding A). Demonstrates inheritance +
// the `super(args)` ctor call end-to-end.
// ---------------------------------------------------------------------------

class ThresholdSensor extends Sensor {
  threshold: int32_t;

  constructor(pin: int32_t, threshold: int32_t) {
    super(pin);
    this.threshold = threshold;
  }

  // Smoothed reading: average Config.SMOOTHING raw samples via the inherited
  // `rawReading()` (base-class method, called without `super.`). Integer
  // division; the smoothing divisor uses the namespace helper.
  smoothed(): int32_t {
    let sum: int32_t = 0;
    for (let i: int32_t = 0; i < Config.SMOOTHING; i = i + 1) {
      sum = sum + this.rawReading();
    }
    return sum / Config.halfWindow() / 2;
  }

  // Whether the latest smoothed reading is over the threshold.
  isOver(): boolean {
    return this.smoothed() > this.threshold;
  }
}

// ---------------------------------------------------------------------------
// Configure the pins once (top-level → setup). `led`/`adc` are top-level
// aliases; HAL resolution is order-independent (demo #34 Finding C).
// ---------------------------------------------------------------------------

const led = LED.asOutput();
const adc = A0.asInput();

// ---------------------------------------------------------------------------
// Driver. Construct one ThresholdSensor on A0 (long-lived; no churn, so the
// single heap allocation is safe even on AVR's small heap), then in a steady
// loop read it, drive the LED to the over-threshold state, and print a report.
// The `new` emits one `heap-allocation-avr` WARNING (correct, intended).
// ---------------------------------------------------------------------------

function main(): void {
  console.log('--- sensor class hierarchy demo ---');
  console.log('threshold=' + Config.THRESHOLD);

  const sensor: ThresholdSensor = new ThresholdSensor(14, Config.THRESHOLD);

  while (true) {
    const value: int32_t = sensor.smoothed();
    const over: boolean = sensor.isOver();
    const ticks: int32_t = sensor.tick();

    if (over) {
      led.high();
    } else {
      led.low();
    }

    console.log('n=' + ticks + ' val=' + value + ' led=' + (over ? 'on ' : 'off'));
    Timing.delay(Config.PERIOD_MS);
  }
}

main();
