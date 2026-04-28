# Board Package Documentation

Board packages (`@typehal/board-<vendor>-<model>[-<hal>]`) define a specific board's capabilities and pin mappings.

## Documents

- [Board Package Development Guide](./development-guide.md) - How to create new board packages
- [Board Usage Guide](./usage-guide.md) - Using board packages in your projects

## Naming Convention

Board packages follow the pattern: `@typehal/board-<vendor>-<model>[-<hal>]`

| Component | Description | Examples |
|-----------|-------------|----------|
| `<vendor>` | Board manufacturer | `arduino`, `esp`, `stm32` |
| `<model>` | Board model | `uno`, `nano`, `esp32-devkit` |
| `<hal>` | Optional HAL override | `native`, `espidf` (defaults to `arduino`) |

### Examples

| Package | Vendor | Model | HAL | Description |
|---------|--------|-------|-----|-------------|
| `@typehal/board-arduino-uno` | Arduino | Uno | arduino (default) | Arduino Uno with Arduino framework |
| `@typehal/board-arduino-uno-native` | Arduino | Uno | native | Arduino Uno with native AVR codegen |
| `@typehal/board-esp-esp32-devkit` | ESP | ESP32-DevKit | arduino (default) | ESP32 with Arduino framework |
| `@typehal/board-esp-esp32-devkit-espidf` | ESP | ESP32-DevKit | espidf | ESP32 with ESP-IDF FreeRTOS |

## Available Board Packages

| Package | FQBN | Target | MCU |
|---------|------|--------|-----|
| `@typehal/board-arduino-uno` | `arduino:avr:uno` | `avr` | ATmega328P |
| `@typehal/board-arduino-uno-native` | `arduino:avr:uno` | `avr` | ATmega328P (native codegen) |
| `@typehal/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` | SAMD21 |
| `@typehal/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` | ESP32 |

## Quick Start

```typescript
import { LED, delay, HIGH } from '@typehal';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
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
@typehal/arch-avr-native (strategy + registers)
            │
            ▼
@typehal/board-arduino-uno (pins + constants)
            │
            ▼
        User Code
```

The board package:
1. Re-exports the architecture's `PlatformStrategy` as `BoardStrategy`
2. Provides board-specific pin mappings (D13 → pin 13, LED → D13)
3. Exports board constants (clock speed, LED pin, etc.)

## Pin Categories

Board packages categorize pins by their capabilities:

| Category | Description |
|----------|-------------|
| `digital` | Digital I/O pins (includes analog pins since they are also digital-capable) |
| `analog` | Analog input pins (ADC) - also support digital I/O |
| `pwm` | PWM-capable pins |
| `interrupt` | External interrupt pins |
| `unsafe` | Pins that generate warnings when used (e.g., boot strapping pins, UART TX/RX) |

### Unsafe Pins

Some pins are marked as "unsafe" because they have special behaviors that can cause issues:
- **UART TX/RX pins** (D0/D1 on Arduino Uno) - Using these interferes with serial communication
- **Boot strapping pins** - Pins that affect boot mode when held in certain states

Unsafe pins can still be used in code, but the transpiler will generate a warning to alert you of potential issues.