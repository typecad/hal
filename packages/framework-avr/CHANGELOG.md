# @typecad/framework-avr

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
