# Board Package Documentation

Board packages (`@typecode/board-*`) define a specific board's capabilities and pin mappings.

## Documents

- [Board Package Development Guide](./development-guide.md) - How to create new board packages
- [Board Usage Guide](./usage-guide.md) - Using board packages in your projects

## Available Board Packages

| Package | FQBN | Target | MCU |
|---------|------|--------|-----|
| `@typecode/board-arduino-uno` | `arduino:avr:uno` | `avr` | ATmega328P |
| `@typecode/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` | SAMD21 |
| `@typecode/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` | ESP32 |

## Quick Start

```typescript
import { Board, delay } from '@typecode';

Board.LED.asOutput();

while (true) {
  Board.LED.toggle();
  delay(500);
}
```

## Package Structure

```
packages/board-<name>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Re-exports architecture + board pins
    ├── pins.ts         # Pin constants: D0-D13, A0-A5, LED
    ├── board.ts        # Board definition and namespace
    ├── peripherals.ts  # I2C0, SPI0, Serial stubs
    ├── timing.ts       # delay, millis, micros
    ├── analog.ts       # analogReference
    └── interrupts.ts   # noInterrupts, attachInterrupt
```

## Relationship to Architecture Packages

Board packages import and re-export architecture strategies:

```
@typecode/arch-avr-native (strategy + registers)
            │
            ▼
@typecode/board-arduino-uno (pins + constants)
            │
            ▼
        User Code
```

The board package:
1. Re-exports the architecture's `PlatformStrategy` as `BoardStrategy`
2. Provides board-specific pin mappings (D13 → pin 13, LED → D13)
3. Exports board constants (clock speed, LED pin, etc.)