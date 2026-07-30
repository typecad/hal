# `@typecad/safety` showcase demo

A sketch (`src/main.ts`) that exercises `@typecad/safety`'s `safe.read(Pin)` —
a `digitalRead` that composes with `@typecad/hal`'s `Pin` class, verifies the
pin's recorded mode at runtime via an auto-populated mode table, performs a
2-of-3 vote via a strategy-injected `__tc_gpio_read` shim, and returns a
`SafeReadResult` carrying any detected fault.

- **Target:** ESP32-S3 (Arduino core via ESP-IDF lowering)
- **Framework:** `@typecad/framework-esp32`
- **Sketch:** two deterministic scenarios surface the `SafeReadResult`
  fault taxonomy end-to-end (no electrical noise required):
  1. **Happy path** — button on GPIO4 (INPUT_PULLUP); `safe.read` returns
     `Ok` and the value drives the LED on GPIO2.
  2. **PinModeMismatch** — GPIO5 deliberately configured as OUTPUT, then
     read; `safe.read` returns a `Configuration` fault.

## What this demonstrates

- **Idiomatic HAL authoring** — `Pin.fromPort("GPIO4").asInputPullUp()` is
  the user-facing mode config; the safety package doesn't second-guess it.
- **Auto-intercept** — every `gpio.set_mode` op (produced by `asInput`/
  `asOutput`/etc.) gets a `safety.record_pin_mode` companion injected by
  the post-build IR transform, so the runtime mode table is authoritative
  regardless of how the user configured the pin.
- **MCU-agnosticism** — the safety package references zero target-specific
  symbols. The voter calls `__tc_gpio_read`, a one-line shim each framework
  strategy contributes (Arduino → `digitalRead`, native → stub).
- **Two-tier fault taxonomy** — `category` (Ok/Signal/Integrity/Timing/
  System/Configuration) is stable across safety standards (ISO 26262,
  IEC 61508, DO-178C); `code` is the specific detail.

## Build

```bash
npm run build       # transpile TS -> C++ (ESP-IDF .cc output)
npm run compile     # transpile + compile with idf.py
npm run lint        # ESLint with the cuttlefish transpiler-rules plugin
```

For AUTOSAR C++14 strict-mode compliance checking (zero deviations expected):

```bash
npx cuttlefish build --autosar=strict
```

## Note on the demo's previous purpose

This demo previously exercised TypeCAD's debug paths (GDB over USB-Serial-JTAG,
printf instrumentation) via a blink sketch. That walkthrough has been
superseded by this safety showcase. The debug-path documentation lived in
this README and the sketch's header comment; both have been replaced. The
separate `STRESS_TEST_FINDINGS.md` (an enum-stress-test writeup from an even
earlier sketch purpose) is now also stale and kept only as historical
reference.

## See also

- Spec: `docs/superpowers/specs/2026-07-27-safety-package-part-a-design.md`
  (Part A v2 section at the top).
- Plan: `docs/superpowers/plans/2026-07-28-safety-package-part-a-v2.md`.
- The safety package itself: `packages/safety/`.
