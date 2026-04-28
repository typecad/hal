# Simulator

The `@typehal/simulator` package provides hardware simulation for testing TypeHAL sketches in Node.js without physical hardware. It implements the same HAL interfaces (`IDigitalPin`, `IAnalogInput`, `IPWMPin`, `ISerialPort`, `II2CBus`, `ISPIBus`) as real board packages, so sketch logic can be tested with standard testing frameworks like Vitest or Jest.

## When to Use the Simulator

| Scenario | Simulator? |
|----------|-----------|
| Unit testing sketch logic (state machines, data parsing, control flow) | ✅ Yes |
| Verifying the correct bus commands are sent to a sensor | ✅ Yes |
| Testing interrupt handler wiring | ✅ Yes |
| Timing-critical code (exact microsecond timing) | ❌ No |
| Analog signal processing (ADC noise, signal integrity) | ❌ No |
| Transpilation output verification | ❌ Use `@typehal/expect` instead |

## Installation

The simulator is included in the TypeHAL workspace. Add it to your test dependencies:

```json
{
  "devDependencies": {
    "@typehal/simulator": "^0.1.0"
  }
}
```

## Quick Start

```typescript
import { describe, it, expect } from 'vitest';
import { createSimBoard } from '@typehal/simulator';

describe('LED blink logic', () => {
  it('toggles LED on pin 13', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });

    // Configure pin 13 as output (same direct API as real hardware)
    board.digital(13).asOutput();

    // Turn LED on
    board.digital(13).high();
    expect(board.digital(13).getBitValue()).toBe(1);

    // Turn LED off
    board.digital(13).low();
    expect(board.digital(13).getBitValue()).toBe(0);
  });
});
```

## Documentation

| Guide | Description |
|-------|-------------|
| [GPIO Simulation](./gpio-simulation.md) | Digital, analog, PWM, and interrupt pins |
| [Bus Simulation](./bus-simulation.md) | UART serial, I2C, and SPI buses |
| [Board Factory](./board-factory.md) | Creating configured board instances |

## Architecture

The simulator mirrors the HAL interface hierarchy from `@typehal/core`:

```
SimBoard (factory: createSimBoard)
├── SimDigitalPin  implements IDigitalPin
├── SimAnalogPin   implements IAnalogInput
├── SimPWMPin      extends SimDigitalPin, implements IPWMPin
├── SimInterruptPin implements IInterruptPin
├── SimSerialPort  implements ISerialPort
├── SimI2CBus      implements II2CBus
└── SimSPIBus      implements ISPIBus
```

Each simulation class implements the full HAL API, so code under test uses the same calls as production code:

```typescript
// Production code (runs on hardware)
UART0.begin(BaudRate._9600);
UART0.println('Hello');

// Test code (runs in Node.js)
const board = createSimBoard({ boardType: 'arduino-uno' });
const uart = board.serial(0);
uart.begin(9600);
uart.println('Hello');
const txData = uart.flushTx();
expect(new TextDecoder().decode(new Uint8Array(txData))).toBe('Hello\r\n');
```

## Re-exports

The simulator barrel-exports everything from a single entry point:

```typescript
import {
  // GPIO
  SimDigitalPin,
  SimAnalogPin,
  SimPWMPin,
  SimInterruptPin,
  type InterruptEvent,

  // Bus
  SimSerialPort,
  SimI2CBus,
  type I2COperationLog,
  SimSPIBus,
  type SPIOperationLog,

  // Board
  SimBoard,
  createSimBoard,

  // Types
  type PinChangeCallback,
  type InterruptCallback,
  type ISimI2CDevice,
  type ISimSPIDevice,
  type SimBoardType,
  type SimBoardConfig,

  // Helpers
  createByteReadResult,
  createWriteResult,
} from '@typehal/simulator';
```
