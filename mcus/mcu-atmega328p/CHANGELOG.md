# @typecad/mcu-atmega328p

## 1.0.0-alpha.7

### Patch Changes

- Updated dependencies [0320018]
  - @typecad/cuttlefish@1.0.0-alpha.7
  - @typecad/hal@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.6
- @typecad/hal@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.5
  - @typecad/hal@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.4
  - @typecad/hal@1.0.0-alpha.4

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

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.3
  - @typecad/hal@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.2
  - @typecad/hal@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.1
  - @typecad/hal@0.1.0-alpha.1
