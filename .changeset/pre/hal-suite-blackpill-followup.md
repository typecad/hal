---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/hal': minor
---

## HAL hardware suite follow-up: per-board configs, EEPROM removal, interrupt + validation fixes

Follow-up to the Black Pill hardware-suite bring-up, driven by its findings:

- **test(hal): per-board suite.** The package now mirrors the repo-root
  `tests/hardware` method: board-agnostic groups in `tests/` (bus singletons,
  `LED`/`A0`, numeric ambient calls) and pin-name-specific groups in
  `tests/boards/<board>/`, with one config per target selected via
  `cuttlefish-test --config` — `cuttlefish.config.ts` (Black Pill, default),
  `esp32-devkit.config.ts`, `uno.config.ts`. Scripts: `test:hw` (default),
  `test:hw:esp32`, `test:hw:uno`.
- **fix(cuttlefish): capability lookups on sparse pin arrays.** `pins.all`
  is keyed by position but HAL pin numbers are sparse once a pad is unbonded
  (STM32F411 has no PB11, so PB12 = number 28 sits at index 27) — capability
  validation and pulldown validation read the WRONG pin's entry past the
  first gap. Lookups now resolve the entry by its `number` field
  (`pinEntryIndexForNumber`).
- **fix(cuttlefish): board-constants flattener resolves same-file const
  references.** MCU capability objects declared once and referenced by every
  pin (`capabilities: GPIO_ANALOG`, `pwm: YES`, including spreads) flattened
  to nothing, so pin-capability validation rejected every pin on boards
  using the pattern.
- **fix(framework-zephyr): attachInterrupt on ANY GPIO.** Interrupts were
  limited to pins with DT-spec entries (buttons); every other pin lowered to
  a silent comment no-op. Pins inside a declared controller range now attach
  through the raw-controller gpio_callback chain; only numbers no controller
  covers are flagged.
- **fix(framework-zephyr): getPwmFrequency/Resolution agree with the
  constant fold.** The transpiler folds them to the MCU manifest's
  peripherals.pwm constants (Black Pill: 50 MHz / 16-bit) while the runtime
  lowering returned 1e9/period (50 Hz) and 8 — a folded literal and a
  runtime call disagreed. The lowering now prefers the declared constants.
- **fix(cuttlefish): millis() link error under the async runtime.** The
  emitted shim's millis() definition was stripped when a program's only
  consumer is the injected static async runtime (Async.sleep lowers to a raw
  op the timing scanners can't see) — undefined reference at link time.
- **feat(hal)!: EEPROM removed from the HAL.** Persistent storage goes
  through `Preferences` (ZMS-backed settings on Zephyr, NVS on ESP32,
  EEPROM-backed shim on AVR internally). The `EEPROM` class, its ambient
  declaration, lowering gating, and the hardware test are gone.
