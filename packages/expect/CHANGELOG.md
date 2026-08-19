# @typecad/expect

## Unreleased

- **Dropped `output.optimize` from the config re-emitter.** The hw-test
  runner's mini config parser read `output.optimize` from
  `cuttlefish.config.ts` and copied it into the generated test config —
  dead weight now that the key is removed from cuttlefish (no framework
  ever consumed it). Old configs carrying the key are simply ignored here.

## 1.0.0-alpha.12

### Patch Changes

- ## Standalone-install dependency fixes

  Declared the dependencies each package actually consumes at build/test time,
  so installs outside the monorepo resolve without relying on hoisting:

  - **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
    test harness generates `cuttlefish.config.ts` files whose
    `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
    typecheck in standalone installs) and `@typecad/framework-zephyr` as an
    optional dependency (the `west build`/`west flash` compile path requires it
    dynamically and degrades gracefully when absent).
  - **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
    dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
    resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
  - **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
    regular dependencies (it is imported throughout `src/`), so installing
    `@typecad/ui` pulls the transpiler automatically like every other consumer.
  - **`@typecad/safety`** dropped its duplicate peerDependencies block —
    `@typecad/cuttlefish` and `@typecad/hal` were declared in both
    `dependencies` and `peerDependencies`; the regular dependencies (the pattern
    every other package uses) are kept.

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.12
  - @typecad/hal@1.0.0-alpha.12

## 1.0.0-alpha.11

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.11

## 1.0.0-alpha.10

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.6

## 1.0.0-alpha.5

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

## 0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.
