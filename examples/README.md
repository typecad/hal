# TypeCode Examples

This directory is the quickest way to see how the public API is intended to be used.

The examples are ordered as a progression, not a grab bag. Earlier files show basic direct usage, while later files capture the newer recommended patterns around type-narrowed GPIO aliases and explicit peripheral ownership.

## Recommended starting points

- `01-blink.ts`: minimal blink example using the recommended `asOutput()` pattern.
- `01b-blink-object.ts`: direct API versus object-style GPIO, side by side.
- `20-gpio-object-pattern.ts`: the clearest reference for modern GPIO configuration.
- `21-bus-ownership.ts`: the clearest reference for `take()` / `release()` on I2C, SPI, and UART.

## Example groups

- `01` to `04`: basic GPIO, analog, PWM, and interrupts.
- `05` to `06c`: I2C and SPI usage patterns, including device accessors and transactions.
- `07` to `19`: board features, testing, native integration, utilities, validation, register mapping, and units.
- `20` to `21`: current recommended patterns for GPIO objects and bus ownership.

## Notes on API style

- Recommended GPIO style: `const led = LED.asOutput()` and then `led.toggle()`.
- Legacy-compatible GPIO style: `LED.output(); LED.toggle();`.
- Recommended shared-bus style: `const bus = I2C0.take(); if (bus) { ...; bus.release(); }`.
- Some older examples still use direct access APIs where that makes the feature being demonstrated shorter or easier to compare.

## Hardware test example

`09-expect-demo.test.ts` is intentionally both an example and a hardware test artifact. It demonstrates the user-facing `@typecode/expect` fluent API and is meant to be run as a hardware test, not as part of the Vitest unit suite.

## Related references

- See `docs/hal-guide.md` for API-oriented guidance.
- See `tests/gpio-object-creation.test.ts` and `tests/bus-ownership.test.ts` for verification of the newer GPIO and ownership patterns.