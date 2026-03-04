# TypeCode Documentation

TypeCode is a TypeScript to C++ transpiler for embedded development. Write TypeScript, compile to Arduino/C++ firmware.

## Package Types

| Package Type | Pattern | Description | Documentation |
|--------------|---------|-------------|---------------|
| **Board** | `board-<vendor>-<model>[-<hal>]` | Hardware abstraction for specific boards | [Board Packages](./board/) |
| **Architecture** | `arch-<cpu>-<hal>` | CPU-specific code generation with HAL | [Architecture](./architecture/) |
| **CLI** | - | Command-line interface | [CLI](./cli/) |
| **Transpiler** | - | TypeScript to C++ transpilation | [Transpiler](./transpiler/) |
| **Toolchain** | - | Compiler and uploader tools | [Toolchain](./toolchain/) |
| **Expect** | - | Hardware testing framework | [Expect](./expect/) |
| **Debug** | - | Breakpoint-based debugging | [Debug](./debug/) |

### Naming Conventions

**Architecture packages:** `@typecode/arch-<cpu>-<hal>`

| Component | Description | Examples |
|-----------|-------------|----------|
| `<cpu>` | CPU architecture | `avr`, `esp32`, `arm`, `riscv` |
| `<hal>` | HAL/framework variant | `native`, `arduino`, `espidf`, `freertos`, `zephyr` |

**Board packages:** `@typecode/board-<vendor>-<model>[-<hal>]`

| Component | Description | Examples |
|-----------|-------------|----------|
| `<vendor>` | Board manufacturer | `arduino`, `esp`, `stm32` |
| `<model>` | Board model | `uno`, `nano`, `esp32-devkit` |
| `<hal>` | Optional HAL override | `native`, `espidf` (defaults to `arduino`) |

### HAL/Framework Variants

Different HALs provide different runtime services and code generation:

| HAL | Threading | Timing | Use Case |
|-----|-----------|--------|----------|
| `native` | Bare metal | `_delay_ms()` | Minimal footprint, direct register access |
| `arduino` | `loop()` | `delay()`, `millis()` | Arduino ecosystem compatibility |
| `espidf` | FreeRTOS | `vTaskDelay()` | ESP32 with ESP-IDF |
| `freertos` | FreeRTOS | `vTaskDelay()` | Generic FreeRTOS |
| `zephyr` | Zephyr threads | `k_sleep()` | Zephyr RTOS |

## Quick Start

### Installation

```bash
npm install typecode
```

### Write TypeScript

```typescript
// sketch.ts
import { LED, delay } from '@typecode';

LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
```

### Transpile & Upload

```bash
npx typecode sketch.ts --compile --upload --port COM4
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     TypeScript Source                        │
│                    (sketch.ts, board packages)               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      CLI (packages/cli)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Config Loader│  │  Transpile   │  │ Platform Strategy│   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Transpiler Pipeline                        │
│  ┌────────┐   ┌────────┐   ┌────────────┐   ┌───────────┐  │
│  │  AST   │ → │  IR    │ → │Tree Shaking│ → │C++ Emitter│  │
│  └────────┘   └────────┘   └────────────┘   └───────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Generated C++/Arduino                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Toolchain (packages/toolchain)            │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │   Arduino CLI    │         │   PlatformIO     │          │
│  │  compile/upload  │         │  compile/upload  │          │
│  └──────────────────┘         └──────────────────┘          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Target Board                           │
│                  (Arduino, ESP32, STM32, etc.)               │
└─────────────────────────────────────────────────────────────┘
```

## Documentation Sections

### [Board Packages](./board/)

Board packages provide hardware abstractions for specific boards:

- Pin definitions (digital, analog, PWM)
- Peripheral configuration (UART, SPI, I2C)
- Timing and interrupts
- Board-specific constants

### [Architecture](./architecture/)

Architecture packages provide native implementations:

- Direct register access
- Low-level peripheral drivers
- Platform-specific optimizations

### [CLI](./cli/)

Command-line interface documentation:

- [CLI Reference](./cli/reference.md) - All commands and flags
- [Configuration](./cli/configuration.md) - typecode.config.ts options

### [Transpiler](./transpiler/)

Transpiler documentation:

- [Language Reference](./transpiler/language-reference.md) - TypeScript to C++ mapping
- [IR Model](./transpiler/ir-model.md) - Intermediate representation
- [Polyfills](./transpiler/polyfills.md) - Runtime polyfill system

### [Toolchain](./toolchain/)

Toolchain documentation:

- [Arduino CLI](./toolchain/arduino-cli.md) - Arduino CLI integration
- [PlatformIO](./toolchain/platformio.md) - PlatformIO integration

### [Expect](./expect/)

Hardware testing framework:

- [Writing Tests](./expect/writing-tests.md) - Test syntax and matchers
- [CLI Reference](./expect/cli-reference.md) - Test runner options

### [Debug](./debug/)

Breakpoint-based debugging for embedded devices:

- Set breakpoints in VS Code
- Debug on-device via serial output
- Inspect variables at runtime

## Examples

See the `examples/` directory for sample code:

| Example | Description |
|---------|-------------|
| `01-blink.ts` | Basic LED blink |
| `02-analog-serial.ts` | Analog read with serial output |
| `03-pwm-fade.ts` | PWM LED fading |
| `04-interrupt.ts` | External interrupt handling |
| `05-i2c-sensor.ts` | I2C sensor reading |
| `06-spi-shift-register.ts` | SPI shift register |
| `07-board-namespace.ts` | Board namespace usage |
| `08-analog-to-pwm.ts` | Analog to PWM conversion |

## Contributing

See the package-specific guides:

- [Board Package Guide](./board/package-guide.md) - Creating board packages
- [Architecture Guide](./architecture/development-guide.md) - Creating architecture packages