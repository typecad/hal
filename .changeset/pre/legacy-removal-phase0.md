---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Legacy HAL removal — Phase 0 + the first legacy slice (the repo stays green; the remaining phases are sequenced behind this).

**Phase 0 — gap closers (the thin replacements for legacy features the removal needs):**
- `PWM.tone(hz)` — the legacy `tone()` as sugar: one `pwm_set_dt` at 50% duty (`period = 1e9/hz`). Documented channel-ownership caveat: tone takes over the period; a later setPulse/setDuty at a not-yet-run call site re-applies the construction period once.
- `shiftOut(dataPin, clockPin, value, msbFirst?)` / `shiftIn(dataPin, clockPin, msbFirst?)` — the legacy shift shape as free functions lowering to ONE op each (`gpio.shift_out`/`gpio.shift_in`): both pins configured once (guarded), then a Zephyr-verbs bit-bang loop (`gpio_pin_set_raw` / `gpio_pin_get_raw` + `k_busy_wait`). New ops wired through the IR, resolver, usage accounting, manifests, and lowering; documented "for real SPI use SPITarget".

**Legacy shift — fully removed** (pulled forward from Phase 2 after the collision it caused): `hal/shift.ts` (the `Shift` class + free functions + `shiftOut_`/`shiftIn_` stubs), the `shift.out`/`shift.in` ops and resolver cases, the manifest sections in BOTH frameworks, the validator's `shift` category + prefix, the strategy ambient flags, the pulse-or-shift lowering's shift half, and the legacy tests. The removal surfaced a real registry hazard worth recording: `halGlobalFunctions` is keyed by bare function name with LAST-FILE-WINS semantics — the legacy `shift.ts` (alphabetically after `shift-pin.ts`) silently overwrote the thin entry, which is why the thin functions "didn't work" until the legacy file was deleted.

**Deferred with reasons**: `pulseIn`/`Pulse` (counter-based input capture needs a hardware-validated design — 2–3 days), `waitForRising/Falling` (interrupt-based thin equivalent, 1 day). Both are on the removal's Phase-0 ledger before the legacy files go.

**Remaining phases** (tracked in the removal plan): 1a port the Arduino demos (UI trio configs + network demo conversions), 1b delete framework-arduino/arduino-cli/mcu-atmega328p/board-arduino-uno + the legacy hal hardware suite, 2 gut the remaining legacy classes/ops (GPIO/PWM/ADC/Wire/tone/timing/… + `pin-state-tracking.ts` wholesale) with the ~300–500 test updates, 3 simulator contracts, 4 docs/semver.
