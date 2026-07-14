# @typecad/framework-avr

Native AVR register-level code generation for TypeCAD.

## Overview

`@typecad/framework-avr` is a TypeCAD framework strategy that emits **direct
AVR register access** instead of Arduino Wiring calls. Where
`@typecad/framework-arduino` lowers `D13.high()` to `digitalWrite(13, HIGH)`,
this package lowers it to `PORTB |= 0x20` — the bare-metal instruction the
compiler would eventually produce anyway, without the function-call overhead
or the Arduino core dependency.

This is the right choice when you want tighter control over AVR hardware
behavior, faster firmware, smaller binaries, or fewer runtime dependencies
than the Arduino framework provides.

### What it lowers natively

| Operation | Arduino framework | framework-avr |
|---|---|---|
| Pin output high | `digitalWrite(13, HIGH)` | `PORTB \|= 0x20` |
| Pin output low | `digitalWrite(13, LOW)` | `PORTB &= ~0x20` |
| Pin read | `digitalRead(13)` | `((PINB & 0x20) ? 1 : 0)` |
| Pin toggle | `digitalWrite(n, !digitalRead(n))` | `PINB \|= 0x20` |
| Pin mode | `pinMode(13, OUTPUT)` | `DDRB \|= 0x20` |
| PWM write | `analogWrite(11, 128)` | `OCR2A = 128` |
| ADC read | `analogRead(A0)` | `({ ADMUX = (1<<REFS0)\|0; ...; ADC; })` |

Timing, I2C, SPI, UART, and interrupts fall through to the parent Arduino
strategy — only GPIO, PWM, and ADC are lowered to registers.

## Supported chips

Pin/register mapping is driven by **chip descriptors** — pure-data tables
under `src/chips/`. Adding a chip is editing a data file, not strategy code.

| Chip | Board | Descriptor |
|---|---|---|
| ATmega328P | Arduino Uno, Nano | `ATMEGA328P` |
| ATmega2560 | Arduino Mega 2560 | `ATMEGA2560` |

The active chip is selected automatically from your config's `buildTarget`
(FQBN): `arduino:avr:uno` → ATmega328P, `arduino:avr:mega` → ATmega2560.

## Quick start

Use the package in your `cuttlefish.config.ts`:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-avr',
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },
  output: { optimize: 'size' },
};

export default config;
```

Transpile, compile, and upload:

```bash
npx cuttlefish src/main.ts --compile --upload --port COM4
```

## Pin references

Pins should be referenced by their **AVR datasheet port names** (`PB5`,
`PD7`, `PC0`), not Arduino `Dx`/`Ax` aliases. Port names are the canonical,
chip-portable identity for a bare-metal framework:

```ts
import { PB5, PD7, PC0 } from '@typecad/board';

PB5.asOutput().high();   // → PORTB |= 0x20
const a = PC0.asInput(); // → ADMUX channel 0
a.readAnalog();          // → ADC register read
```

## Exports

### Strategy

- `NativeAVRStrategy` / `FrameworkStrategy` — the platform strategy class.
  Pass a chip descriptor to the constructor to override the FQBN-derived
  default: `new NativeAVRStrategy(ATMEGA2560)`.
- `PlatformStrategy` — re-exported type.

### Toolchain

Compile/upload/monitor via `arduino-cli` (re-exported from
`@typecad/framework-arduino` — the build path has no framework-strategy
coupling):

- `Toolchain` — the loader-contract object (`prepare`/`compile`/`upload`/`monitor`).
- `flattenGeneratedModulesIntoSketch`, `compileArduinoSketch`,
  `uploadArduinoSketch`, `monitorArduinoSketch`.

### Library resolution

- `isFrameworkLibraryImport`, `getFrameworkLibraryHeaderName` — Arduino
  library import detection.
- `buildClassNameMap` — library class-name mapping.
- `tryGenerateLibDecl` — `.d.ts` generation for discovered libraries.

### Chip descriptors

- `ATMEGA328P`, `ATMEGA2560` — descriptor instances.
- `setActiveChip` — select the active chip at runtime.
- Types: `AVRChipDescriptor`, `AVRPinMap`, `AVRTimer`, `AVRPwmPin`,
  `AVRInterruptPin`, `AVRAdcConfig`, `AVRUartConfig`.

### Profile resolution

- `resolveAvrProfile` — resolve the chip + diagnostics from a build target.
- `chipForBuildTarget` — map a FQBN to its chip descriptor.
- `ResolvedAvrProfile` — resolved profile type.

### Register helpers

Chip-agnostic reads over the active descriptor:

- `getPinInfo`, `getPinBitMask`, `getPortReg`, `getDDRReg`
- `getADCChannel`, `getPWMInfo`, `isPWMPin`, `getPWMPins`
- `getInterruptInfo`, `isInterruptPin`
- `inferReceiverKind`, `parsePinFromReceiver`

## Diagnostics

Invalid pins and unsupported peripherals surface as structured diagnostics
instead of silent `/* invalid pin */` comments. For example, using a pin that
doesn't exist on the selected chip produces:

```
error [avr-invalid-pin]: D40 is used as an output but has no PORT/DDR mapping on the atmega328p.
  → Pin D40 is not valid on the atmega328p. See the chip's pin map in src/chips/atmega328p.ts.
```

Diagnostic codes: `avr-invalid-pin`, `avr-pwm-unsupported`.

## Testing

### Unit tests (vitest)

```bash
npx vitest run tests/packages/framework-avr
```

Covers HAL resolution (register string output), chip-descriptor portability
(328P vs 2560), and profile resolution (FQBN selection, diagnostics).

### On-device hardware tests

```bash
npm run test:hw          # run the full suite
npm run test:hw:basics   # run one file
```

Each `.test.ts` transpiles to a sketch, flashes to a real ATmega328P, and
the firmware reports pass/fail over UART. Requires a board connected via
serial (see `cuttlefish.config.ts` `test.port`). Tests are wiring-free —
they rely on internal pullups and in-range checks, no breadboard jumpers.

## License

MIT
