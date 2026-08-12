# @typecad/cuttlefish

## 1.0.0-alpha.9

### Minor Changes

- a27476a: ## New `cuttlefish install` command

  Adds a `cuttlefish install [framework] [--board id] [--dry-run]` subcommand that
  installs a `@typecad/framework-*` package into the current project. It asks
  which board to target, narrows the framework choices to the ones compatible
  with that board (arduino / zephyr / native), detects the package manager
  (npm / yarn / pnpm) from the lockfile, and runs the install — or prints the
  resolved command with `--dry-run` for CI / scripting. The init wizard's
  "no framework found" error now points users at `cuttlefish install` instead of
  a manual `npm i`.

### Patch Changes

- @typecad/safety@1.0.0-alpha.9
- @typecad/ui@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/ui@1.0.0-alpha.8
- @typecad/safety@1.0.0-alpha.8

## 1.0.0-alpha.7

### Minor Changes

- 0320018: ## ESP32: BLE, WiFi/HTTP, RMT, native display + touch, ESP-IDF v6

  The ESP32 framework is now a first-class code-generation target alongside the
  AVR and Arduino cores, with native ESP-IDF lowering across every HAL category.

  ### BLE peripheral (NimBLE)

  - Full GATT peripheral lowering via NimBLE: `ble.server(name)`,
    `.characteristic(uuid, type, perm)`, `.onRead()/.onWrite()/.onConnect()/
onDisconnect()`, `.notify()`, `.set_tx_power()`.
  - Supports 16-bit SIG UUIDs, custom 128-bit UUIDs, and all read-value types
    (numeric, UTF-8, raw bytes). Auto-creates a default service when
    characteristics have no explicit parent.
  - Async `ble.until_connected()` split lowers to a non-blocking poll state.
  - `Preferences` backed by native NVS lowering (reads/writes persist across
    reboots); `Power.deepSleepPin()` pin-wakeup.

  ### WiFi + HTTP client (native, async)

  - Native WiFi HAL with async lowering: `WiFi.connect()` lowers to start + poll
    states so a heartbeat loop keeps running while the link comes up. AP mode,
    tx power, channel, max clients, and client-count queries.
  - HTTP client (`http.get/post`, async, HTTPS-insecure) end-to-end lowering with
    brownout-recovery fixes. Includes a hardware-test harness
    (`npm run test:http` + `test:hw:http`) and a compiled-output regression
    corpus (`demos/wifi-demo/out-samples`).

  ### RMT (ESP32-S3 onboard WS2812)

  - `rmt.*` HAL-op IR + ergonomic stubs + `hal/rmt.ts` wrapper. IR-scanning init
    lines + per-op lowering, wired into dispatch with forced `esp_driver_*`
    CMake deps. MSB-first `txInit` for WS2812. Drives the ESP32-S3 onboard RGB.

  ### Native display + touch adapters

  - Native ESP32 SPI display adapters (ILI9341, ST7796, SSD1309) and touch
    adapters (XPT2046, STMPE610, GT911, CST816S, FT6336U) with PSRAM + rendering
    fixes. License attribution headers added to touch adapters (NOTICE updated).

  ### ESP-IDF v6 migration

  - `framework-esp32` migrated to ESP-IDF v6 public APIs: NimBLE API + callback
    fixes, removed deprecated `esp_nimble_hci`/`esp_ble_tx_power_set`, volatile
    `++` replaced with `+ 1` for GCC 13+ `-Werror=volatile`. Compiles clean on
    v6 (`idf.py build` passes).

  ### Bug fixes

  - ownership-analysis: const-array demotion now fires for value-arg mutating
    methods lowered via `__RAW_STMT__` (e.g. `arr.push()` on a `const` binding no
    longer emits a non-compiling `const std::vector` + `push_back`).
  - framework-avr: the UART driver shim is kept alive for `console.*` programs,
    since the AVR console polyfill routes `console.log` through `_uart_*` symbols
    (previously emitted an undefined-symbol link error).

### Patch Changes

- Updated dependencies [0320018]
  - @typecad/ui@1.0.0-alpha.7
  - @typecad/arduino-cli@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.6
  - @typecad/ui@1.0.0-alpha.6

## 1.0.0-alpha.5

### Minor Changes

- ## framework-avr: gate native driver shims on actual peripheral usage

  framework-avr previously emitted ~400 lines of uncalled native driver code
  (UART, SPI, TWI/I2C, EEPROM, tone, millis Timer0 ISR, delay/map/constrain
  helpers, and two unreferenced headers) for every AVR program — even a trivial
  `led.toggle()`. For the demo this was 417 lines / 800 B flash; it is now
  28 lines / 140 B flash and contains only what the program uses.

  ### Usage-gated shim emission

  Mirrors framework-arduino's post-hoc filtering model: each native shim block
  carries stable `CUTTLEFISH_*_BEGIN/END` markers, and the shared setup emitter
  strips unused blocks based on `programAnalysis` flags. The AVR strategy also
  self-gates on the same flags (defensive default: emit when no analysis is
  available, preserving direct-strategy unit-test behavior).

  New analysis flags in `program-analysis.ts` (`usesUart`, `usesSPI`, `usesI2C`,
  `usesEEPROM`, `usesTone`, `usesMap`, `usesConstrain`, `usesNativeTiming`) detect
  usage through structured HAL-op names, lowered callees, and raw-code references
  — covering the HAL resolver's lowering paths that the pre-existing regex scans
  missed. `usesNativeTiming` derives the comprehensive gate for the millis ISR
  (direct calls + setInterval/setTimeout + async + UI tick).

  ### framework-arduino: on-demand `<avr/wdt.h>`

  Also fixes a related leak in framework-arduino: `<avr/wdt.h>` was a forced
  include for every AVR program. It is now added on demand by the setup emitter
  when the program actually references `wdt_*` symbols (detected via `wdt.`
  hal-ops), using the same post-hoc filter pattern.

### Patch Changes

- @typecad/ui@1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- ## cuttlefish licenses + doctor: license compliance auditing

  New CLI commands for environment verification and license compliance auditing of
  Arduino dependencies.

  ### `cuttlefish licenses [--all] [--strict]` (new)

  Audits the SPDX licenses of the Arduino libraries a project depends on, with
  copyleft risk classification. Resolves each library's license from
  `library.properties` → `LICENSE` file → source-header comment, normalized via a
  static SPDX table (MIT, BSD-2/3, Apache-2.0, LGPL-2.1/3.0, GPL-2.0/3.0,
  AGPL-3.0, Unlicense, CC-BY/SA/NC-4.0, including `-only`/`-or-later` variants).

  **Project-scoped by default.** Resolves the project's library set from the
  generated `.ino`'s `#include` directives (authoritative — exactly what
  arduino-cli links), with a config-derived display/touch fallback when no `.ino`
  exists. `--all` restores system-wide scanning of every installed library.

  **Four-layer header resolution** (project scope), in order:

  1. User libraries (`arduino-cli lib list`) → resolved with license
  2. Core-bundled libraries (the project's own board core, derived from the FQBN
     via `arduino-cli config dump`) → resolved with license (e.g. `Wire` →
     `LGPL-2.1`, read from its header notice)
  3. Toolchain headers (`avr/*.h`, `util/*.h` from avr-libc) → gray
     `CORE/TOOLCHAIN` row, not flagged as missing
  4. Not installed → red `NOT INSTALLED` (the actionable missing-dependency case)

  Output sorts worst-first: strong copyleft `[COPYLEFT]`, weak copyleft
  `[weak copyleft]`, permissive `✓`, then unknown `UNKNOWN`. `--strict` exits
  non-zero on unknown licenses or missing dependencies (CI-enforceable).

  ### `cuttlefish doctor` (new)

  Verifies `arduino-cli` is installed and the board core for the configured
  `buildTarget` (FQBN) is present, with the exact `arduino-cli core install`
  command to fix a missing core.

  ### Resolver + detection improvements

  - **Library name normalization**: bare import specifiers with underscores
    (`Adafruit_ILI9341`) now correctly resolve to libraries whose arduino-cli
    name uses spaces (`Adafruit ILI9341`), instead of falling back to a
    PascalCase header guess. Fixes `licenses` falsely reporting libraries as
    not-installed.
  - **Broadened license detection** for real-world Arduino libraries: British
    `LICENCE.txt` spelling, `LICENSE` under `src/`, source-header comment scanning
    (the Adafruit pattern), short-form markers (`BSD license`, `Apache License`),
    and the `SPDX-License-Identifier:` marker with `-only`/`-or-later` suffixes.
  - **Project-local header exclusion**: headers co-located with the `.ino`
    (cuttlefish-emitted polyfills) are recognized as project code, not missing
    libraries.

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.4
  - @typecad/ui@1.0.0-alpha.4

## 1.0.0-alpha.3

### Minor Changes

- ## framework-avr: full bare-metal framework

  The `@typecad/framework-avr` package is now a complete, production-ready
  framework for native AVR register-level code generation. It went from an
  unmaintained stub to a fully-featured framework at parity with
  `@typecad/framework-arduino`.

  ### Native register lowering (55 HAL ops)

  Every hardware peripheral is lowered to direct register access — no HAL op
  falls through to Arduino Wiring calls:

  - **GPIO** (PORT/DDR/PIN), **PWM** (OCRnx), **ADC** (ADMUX/ADCSRA)
  - **Timing** (Timer0 overflow ISR + fractional millis), **Interrupts** (EICRA/EIMSK)
  - **Tone** (Timer2 CTC + GPIO toggle), **Pulse/Shift** (micros + GPIO loops)
  - **SPI** (SPCR/SPSR/SPDR), **UART** (USART0), **I2C/TWI** (TWBR/TWCR/TWDR)
  - **EEPROM** (avr-libc `eeprom_read_byte`/`eeprom_write_byte`)

  ### Chip-descriptor portability

  Pin/register mapping is data-driven via `AVRChipDescriptor`. ATmega328P
  (Arduino Uno/Nano) and ATmega2560 (Arduino Mega 2560) descriptors included.
  Adding a chip is a data file, not strategy code.

  ### Bare-metal main() — 72% Flash reduction

  Defining `int main(void)` prevents the Arduino core from being linked,
  yielding dramatically smaller binaries:

  - Minimal pin toggle: **198 bytes** (vs 712 bytes with framework-arduino)
  - Demo (pins + I2C + SPI + timers): **724 bytes** (vs 2.5 KB)

  ### Pluggable OutputShim in @typecad/expect

  The test framework now accepts a pluggable output shim instead of
  hardcoding `Serial.print`. framework-avr provides `avrUartShim` that
  routes test protocol through native `_uart_*` helpers, so test builds
  are fully bare-metal too.

  ### Additional changes across packages

  - `@typecad/cuttlefish`: added `filterRequiredIncludes()` to
    `PlatformStrategy` so frameworks can strip stale HAL includes
  - `@typecad/expect`: `OutputShim` interface, `serialShim`/`avrUartShim`
    built-ins, `ResolvedConfig.framework` field threaded through config
  - All packages: version-aligned at 0.1.0-alpha.3

### Patch Changes

- @typecad/ui@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Fix `requireUIHook()` throwing on builds in projects that do not install the
  optional `@typecad/ui` package.

  After the UI-engine extraction, several call sites in cuttlefish core called
  `requireUIHook()` unconditionally instead of guarding with `hasUIHook()`. In a
  project without `@typecad/ui`, the dynamic import in `loadUIEngine()` fails
  gracefully and leaves the hook null (by design), so the first unguarded call
  threw `Error: UI hook is not registered...` on every build — including plain
  non-UI sketches like the starter blink project.

  Guarded all unconditional call sites with `hasUIHook()` so they no-op when the
  UI engine is absent, restoring the documented "UI is optional" contract:

  - `cli.ts` — UI type-declaration generation (build and watch-rebuild paths)
  - `transpile.ts` — parser-warning and mount-diagnostic loops
  - `orchestrator/type-checker.ts` — UI module registration

  Also added two helpers to `ui/ui-bridge.ts` (re-exported via
  `@typecad/cuttlefish/testing`) so the test suite can reproduce a project that
  has not installed `@typecad/ui`:

  - `resetUIEngine()` — clears the bridge's `loaded` flag and hook, mirroring the
    other `reset*` session helpers (`clearCaches`, `resetDisplayProfile`).
  - `__simulateUIAbsentForTest()` — forces the "import attempted, hook null"
    state, since the monorepo test environment otherwise eagerly registers the
    engine and masks this regression.

  Added a regression test (`tests/packages/transpiler/optional-ui-no-engine.test.ts`)
  covering both the type-check-skipped and type-check-enabled transpile paths
  with the UI engine absent.

  - @typecad/ui@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.

### Patch Changes

- Updated dependencies
  - @typecad/ui@0.1.0-alpha.1
