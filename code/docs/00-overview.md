# @typecode/core - Architecture Overview

## Design Philosophy

@typecode/core is the foundation of the typeCode framework. It provides abstract interfaces and type definitions that enable hardware-agnostic firmware development while enforcing hardware constraints at compile-time.

### Core Principles

1. **Hardware as Types** - Pins, buses, and peripherals are represented as TypeScript types with compile-time validation
2. **Interface-Based Design** - All hardware abstractions are defined as interfaces, allowing architecture-specific implementations
3. **Zero Runtime Overhead** - Type information is used only at compile-time; transpiled code is pure C++
4. **Fail at Compile-Time** - Hardware mismatches are caught in the editor, not on the board

---

## Package Structure

```
@typecode/core/
├── types/
│   ├── pin.ts           # Base pin types and capabilities
│   ├── capabilities.ts  # Pin capability flags and checks
│   └── gpio.ts          # GPIO interface definition
├── bus/
│   ├── i2c.ts           # I2C bus interface
│   ├── spi.ts           # SPI bus interface
│   └── uart.ts          # UART/Serial interface
├── concurrency/
│   ├── scheduler.ts     # Task scheduling primitives
│   ├── task.ts          # Task definition and state
│   └── lock.ts          # Synchronization primitives
└── memory/
    ├── decorators.ts    # Memory placement decorators
    └── buffer.ts        # Fixed-size buffer types
```

---

## Type System Architecture

### Layer 1: Capability Flags

Capability flags are compile-time constants that define what operations a pin or peripheral supports.

```typescript
// Example capability flags
interface PinCapabilities {
  digitalInput: boolean;
  digitalOutput: boolean;
  analogInput: boolean;
  analogOutput: boolean;  // DAC or PWM
  pwm: boolean;
  interrupt: boolean;
  pullUp: boolean;
  pullDown: boolean;
}
```

### Layer 2: Base Pin Types

Pin types are branded with their capabilities, preventing invalid operations.

```typescript
// DigitalPin can only read/write digital values
interface DigitalPin {
  read(): DigitalValue;
  write(value: DigitalValue): void;
}

// PWMPin extends DigitalPin with analog output capability
interface PWMPin extends DigitalPin {
  write(value: AnalogValue): void;  // 0-255 or 0-65535
  setFrequency(hz: number): void;
  setDutyCycle(duty: number): void;  // 0.0 to 1.0
}
```

### Layer 3: Interface Abstractions

Interfaces define contracts for peripherals that any architecture can implement.

```typescript
interface II2CBus {
  read(address: number, buffer: Uint8Array): Promise<number>;
  write(address: number, data: Uint8Array): Promise<void>;
  readRegister(address: number, register: number, buffer: Uint8Array): Promise<number>;
  writeRegister(address: number, register: number, data: Uint8Array): Promise<void>;
}
```

---

## Architecture Shim System

The shim system maps abstract interfaces to architecture-specific implementations.

### Shim Resolution Flow

```
User Code (main.ts)
       │
       ▼
Import from '@typecode/core'
       │
       ▼
typecode.config.ts selects architecture
       │
       ▼
Shim Layer (@typecode/arch-esp32)
       │
       ▼
Transpiler generates C++ for ESP-IDF
```

### Configuration Example

```typescript
// typecode.config.ts
export default {
  target: 'esp32',
  board: '@typecode/board-esp32-devkit',
  architecture: '@typecode/arch-esp32',
  output: {
    framework: 'platformio',
    optimize: 'size'
  }
};
```

---

## Supported Architectures

### Arduino AVR (ATmega328P)

- **Memory**: 2KB SRAM, 32KB Flash, 1KB EEPROM
- **Pins**: 20 GPIO (14 digital, 6 analog)
- **PWM**: 6 pins (3, 5, 6, 9, 10, 11)
- **Serial**: 1 hardware UART
- **I2C**: 1 controller (Wire)
- **SPI**: 1 controller
- **Multicore**: None (bare-metal)

### ESP32 (Xtensa Dual-Core)

- **Memory**: 520KB SRAM, 4MB Flash (typical)
- **Pins**: 34 GPIO (GPIO matrix)
- **PWM**: 16 channels (LEDC)
- **Serial**: 3 hardware UARTs
- **I2C**: 2 controllers
- **SPI**: 4 controllers (2 usable)
- **Multicore**: 2 cores (FreeRTOS)
- **Wireless**: WiFi, Bluetooth

### RP2040 (ARM Cortex-M0+ Dual-Core)

- **Memory**: 264KB SRAM, 2MB Flash (Pico)
- **Pins**: 26 GPIO
- **PWM**: 8 slices (16 channels)
- **Serial**: 2 hardware UARTs
- **I2C**: 2 controllers
- **SPI**: 2 controllers
- **Multicore**: 2 symmetric cores
- **Special**: PIO (Programmable I/O)

---

## Compile-Time Validation Examples

### Invalid Pin Operation (Caught by TypeScript)

```typescript
import { Board } from '@typecode/board-arduino-uno';

// ERROR: A0 is an analog-only input pin, it cannot be written to
Board.A0.digitalWrite(HIGH);

// TypeScript error: Property 'digitalWrite' does not exist on type 'AnalogInputPin'
```

### Unsupported Feature (Caught by TypeScript)

```typescript
import { Board } from '@typecode/board-arduino-uno';
import { Parallel } from '@typecode/core';

// ERROR: Arduino Uno does not support Parallel execution
Parallel.run(() => {
  // ...
});

// TypeScript error: 'Parallel' is not available for target 'avr'
```

### Architecture-Agnostic Driver

```typescript
import { II2CBus } from '@typecode/core';

// This driver works on ANY architecture that provides II2CBus
class BME280 {
  private bus: II2CBus;
  private address: number;

  constructor(bus: II2CBus, address: number) {
    this.bus = bus;
    this.address = address;
  }

  async readTemperature(): Promise<number> {
    const buffer = new Uint8Array(2);
    await this.bus.readRegister(this.address, 0xFA, buffer);
    const raw = (buffer[0] << 8) | buffer[1];
    return raw / 100.0;
  }
}
```

---

## Transpiler Integration

### Type Annotations for Transpiler

The transpiler uses TypeScript metadata to generate correct C++ code.

```typescript
import { Static, ProgramMemory } from '@typecode/core';

@Static()
class SensorData {
  temperature: number;
  humidity: number;
}

@ProgramMemory()
const LOOKUP_TABLE: number[] = [0, 10, 20, 30, 40, 50];
```

### Generated C++ (ESP32 Example)

```cpp
// SensorData is placed in static memory
static struct SensorData {
  float temperature;
  float humidity;
} sensor_data;

// LOOKUP_TABLE is placed in flash (PROGMEM equivalent)
const PROGMEM float LOOKUP_TABLE[] = {0, 10, 20, 30, 40, 50};
```

---

## Current MVP Status (Implemented)

The repository now includes a working npm workspace implementation for the first slice:

- `@typecode/core` with typed contracts for pins, buses, concurrency, memory, board manifests, and diagnostics
- `@typecode/board-arduino-uno` with explicit Arduino Uno pin capabilities and board manifest
- `@typecode/transpiler` MVP CLI that parses `configurePin(Pins.X, "mode")`, validates Uno capabilities, and emits Arduino `main.ino`

### Run the MVP

```bash
npm install
npm run typecheck
npm run transpile:uno
```

Generated output is written to `out/uno/main.ino`.

---

## Next Steps

- **[01-pin-types.md](./01-pin-types.md)** - Detailed pin type hierarchy
- **[02-bus-interfaces.md](./02-bus-interfaces.md)** - I2C, SPI, UART interfaces
- **[03-concurrency.md](./03-concurrency.md)** - Scheduler and task management
- **[04-memory-decorators.md](./04-memory-decorators.md)** - Memory placement control
- **[05-board-definitions.md](./05-board-definitions.md)** - Board manifest format
- **[06-arch-impl-guide.md](./06-arch-impl-guide.md)** - Creating new architecture shims