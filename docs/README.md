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
import { LED, delay, HIGH } from '@typecode';

LED.output(HIGH);

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
- **[Board Definition Builder API](./board/builder-api.md)** — Fluent API for creating board packages

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
- **[Polyfill Plugins](./transpiler/polyfill-plugins.md)** — Extensibility for custom polyfills
- [Arduino Library Integration](./transpiler/arduino-libs.md) - Use Arduino C++ libraries with auto-generated types
- **Mixing TypeScript and C++** - Use native C++ modules alongside TypeScript

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

### Basic Examples

| Example | Description |
|---------|-------------|
| `01-blink.ts` | Basic LED blink |
| `02-analog-serial.ts` | Analog read with serial output |
| `03-pwm-fade.ts` | PWM LED fading |
| `04-interrupt.ts` | External interrupt handling |
| `07-board-namespace.ts` | Board namespace usage |
| `08-analog-to-pwm.ts` | Analog to PWM conversion |

### Serial/UART Examples

| Example | Description |
|---------|-------------|
| `12-native-serial.ts` | Native UART communication |

### I2C Examples

| Example | Description |
|---------|-------------|
| `05-i2c-sensor.ts` | Basic I2C sensor reading |
| `05b-i2c-error-handling.ts` | I2C error handling |
| `05c-i2c-multi-byte-write.ts` | Multi-byte I2C writes |
| `05d-i2c-bus-scan.ts` | I2C bus scanning |
| `05e-i2c-multiple-devices.ts` | Multiple I2C devices |
| `16-i2c-register-shortcuts.ts` | I2C register shortcut methods |

### SPI Examples

| Example | Description |
|---------|-------------|
| `06-spi-basic.ts` | Basic SPI communication |
| `06-spi-shift-register.ts` | SPI shift register |
| `06b-spi-transactions.ts` | SPI transactions |
| `06c-spi-shift-register.ts` | 74HC595 shift register |

### Utilities & Advanced

| Example | Description |
|---------|-------------|
| `09-expect-demo.test.ts` | Hardware testing with expect |
| `11-native-analog-test.ts` | Native analog with peripheral init |
| `13-num-utilities.ts` | Number utilities (map, constrain) |
| `14-pulse-shift-random.ts` | Pulse, shift, and random utilities |
| `15-pin-group-led-bar.ts` | Pin groups for LED bars |
| `17-pin-validation.ts` | Pin validation utilities |

## Contributing

See the package-specific guides:

- [Board Package Guide](./board/package-guide.md) - Creating board packages
- [Architecture Guide](./architecture/development-guide.md) - Creating architecture packages