# HAL hardware test suite

Hardware-in-the-loop coverage for the HAL classes: `typecad-hal test`
transpiles each file, flashes it, and evaluates the assertions on-device
over the `[TC:` protocol. Pin choices live in each board's
`test-pins.json` (roles), so the same test files run on every board.

## Layout

- **`common/`** — board-agnostic groups (no wiring beyond the console):
  timing, math, random, shift, UART (idle-line), I2C (empty bus), ADC,
  watchdog, preferences, async, constants, counter, fs, clock, CAN, I2S,
  thread, trace, USB CDC.
- **`board/`** — role-driven groups (need the rig's named pins, no jumper
  changes): GPIO, PWM, servo, LED strip, HID, LED matrix, SPI, LED,
  one-wire.
- **`wired/`** — opt-in tier needing jumpers (`npm run test:hw:wired`):
  GPIO loopback (level path), interrupt firing (edge path), UART TX→RX
  loopback (marker-scan; the port is console-shared on some boards, so the
  assertion scans for a unique marker rather than byte-exact echo).
- **`network/`** — WiFi/BLE/MQTT/HTTP; hand-configured (SSID in the test
  header, local `npm run test:http` server). Not part of default runs.

## Known untested surfaces (deliberate)

| Surface | Why |
| :--- | :--- |
| `Power.off()` / `Power.offFor()` | Destructive: soft-off silences the console (that IS the effect) and `offFor` reboots the board mid-run. Verifying it means a run whose last act is the assertion; belongs in a dedicated one-test flash, not the default suite. |
| `await`-based async sequencing | The DSL preprocessor flattens chains into protocol calls — it cannot express `await`. `15-async` covers the fire-and-forget callables (`Async.sleep/yield/currentTask`); the `await Time.sleep` state-machine path is exercised by the demos (`zephyr-shell-logger`'s boot) and its threading bugs are engine findings, not suite gaps. |
| `DAC` | Gated export — no route facts harvested for the rig boards, so the class does not lower on either. Add when a board with a DAC channel joins the rig. |
| `Scan` / `WiFiAP` | Need an AP environment (the network tier's hand-config pattern); no rig fixture today. |
| `I2CResponder` | Needs a second I2C controller or peripheral emulator on the bench; the responder's constant-arg diagnostics are covered host-side (`tests/packages/hal/i2c-responder-sim.test.ts`). |
| 1-Wire `Sensor` (`12-onewire`) | Two stacked gaps, both documented in the test header: the `onewire` role is absent until a DS18B20 is wired, AND the `new Sensor(SENSOR.maxim_ds18b20, PIN, …)` Pin-form constructor does not lower yet (`HAL_SENSOR_CTOR` only accepts an I2C device) — the role const mapping now exists, so wiring the probe surfaces the engine gap directly. |

## Verifying suite files without a board attached

`node scripts/verify-hw-test.mjs <test.ts> <boardDir…>` from the repo root
replicates the runner's exact pipeline — preprocess (DSL → protocol +
test-pin substitution) → derived per-file config → `typecad-hal build
--skip-type-check --force`. It is the transpile gate; add `--compile`
inside the generated verify dir for a full west build of one file.
