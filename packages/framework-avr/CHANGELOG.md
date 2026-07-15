# @typecad/framework-avr

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
