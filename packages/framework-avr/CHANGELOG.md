# @typecad/framework-avr

## 1.0.0-alpha.7

### Patch Changes

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

- Updated dependencies [0320018]
  - @typecad/cuttlefish@1.0.0-alpha.7
  - @typecad/framework-arduino@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.6
- @typecad/framework-arduino@1.0.0-alpha.6

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

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.5
  - @typecad/framework-arduino@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.4
  - @typecad/framework-arduino@1.0.0-alpha.4

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

  ### Removed #ifndef ARDUINO guards

  All `#ifndef ARDUINO` guards from alpha.2 have been removed. The
  bare-metal `main()` unconditionally provides native timing, EEPROM,
  and interrupt drivers — the Arduino core is never linked.

  ### Additional changes across packages

  - `@typecad/cuttlefish`: added `filterRequiredIncludes()` to
    `PlatformStrategy` so frameworks can strip stale HAL includes
  - `@typecad/expect`: `OutputShim` interface, `serialShim`/`avrUartShim`
    built-ins, `ResolvedConfig.framework` field threaded through config
  - All packages: version-aligned at 1.0.0-alpha.3

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.3
  - @typecad/framework-arduino@1.0.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- Wired `resolveHALOperation` to lower GPIO/PWM/ADC HAL ops to native AVR
  register access (`PORTB`/`DDRB`/`PINB`/`OCR2A`/`ADMUX`) instead of
  falling through to the parent Arduino strategy's `digitalWrite`/`analogRead`.
- Removed 224-line dead `tryRenderNativeCall` dispatch table (zero callers).
- Added `override` to all shadowed methods; enabled `noImplicitOverride`.
- Fixed `nativeDigitalWrite` non-lvalue ternary (branchless read-modify-write).
- Added chip-descriptor portability layer: `AVRChipDescriptor` + `ATMEGA328P`
  and `ATMEGA2560` descriptors. Adding a chip is a data file, not strategy code.
- FQBN-driven chip selection: `arduino:avr:uno` → ATmega328P,
  `arduino:avr:mega` → ATmega2560, via `resolveAvrProfile`.
- Surfaced structured `Diagnostic[]` for invalid pins (`avr-invalid-pin`)
  and unsupported PWM (`avr-pwm-unsupported`) instead of silent comments.
- Added `Toolchain` export (compile/upload/monitor via arduino-cli).
- Re-exported library-resolution functions from framework-arduino.
- Fixed `shimLines` override to merge parent shims (nullish/PinGroup/async)
  instead of dropping them — previously any program using `undefined` or `??`
  failed to compile.
- Added on-device expect test suite (35 tests) and vitest unit suite (40 tests).
- Native timing: `millis()`/`micros()` via Timer0 overflow ISR (no Arduino core
  `wiring.c`). `setInterval`/`setTimeout` backed by `__tc_TimerRuntime`. The
  `__tc_Timing` struct now routes through native helpers, not `::delay()`.
  `timing.*` HAL ops emit `_native_delay_ms`/`millis()`/`micros()`.
- Native interrupts: `interrupt.attach`/`detach` override configures EICRA/
  EICRB + EIMSK and wires the ISR trampoline (data-driven from chip
  descriptor). The dead `ISR(INT0_vect)` shim is now guarded `#ifndef ARDUINO`.
- Native tone: `_tc_tone_play`/`_tc_tone_stop` using Timer2 CTC mode with
  auto-prescaler selection.
- Native pulse/shift: `pulseIn`/`shiftOut`/`shiftIn` replaced with `micros()`-
  based GPIO polling loops and bit-bang clock loops.
- Native ADC reference: `adc.set_reference` writes ADMUX REFS bits directly;
  `adc.read_voltage` uses the native ADMUX/ADC read.
- Native SPI: `_spi_init`/`_spi_transfer`/`_spi_set_mode`/`_spi_set_bit_order`
  using SPCR/SPSR/SPDR registers. All 9 `spi.*` ops overridden.
- Native UART: all 10 `uart.*` ops mapped to `_uart_*` USART0 helpers with
  template-based print/println, peek, flush, and snprintf-backed printf.
- Native I2C/TWI: `_twi_*` master-mode state machine using TWBR/TWCR/TWDR/
  TWSR with an RX ring buffer. All 13 `i2c.*` ops overridden.
- Native EEPROM: avr-libc `<avr/eeprom.h>` wrappers (`eeprom_read_byte`/
  `eeprom_write_byte`/`eeprom_update_byte`) matching the Arduino EEPROM API.
  Guarded `#ifndef ARDUINO`.
- Invalid-on-AVR ops (`dac.write`, `power.set_cpu_frequency`) now emit no-op
  comments instead of undefined symbols.
- On-device test suite expanded to 39 tests; vitest to 50 tests.

### Patch Changes

- @typecad/cuttlefish@0.1.0-alpha.2
- @typecad/framework-arduino@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.1
  - @typecad/framework-arduino@0.1.0-alpha.1
