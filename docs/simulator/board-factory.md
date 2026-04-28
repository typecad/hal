# Board Factory

The `createSimBoard()` factory creates a fully configured simulated board with all GPIO pins and bus peripherals. It's the recommended entry point for creating simulator instances.

## createSimBoard

```typescript
function createSimBoard(config: SimBoardConfig): SimBoard;
```

### SimBoardConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `boardType` | `SimBoardType` | *(required)* | Board identifier (`'arduino-uno'`, `'arduino-nano'`, or custom string) |
| `digitalPinCount` | `number` | `14` | Number of digital pins |
| `analogPinCount` | `number` | `6` | Number of analog input pins |
| `i2cBusCount` | `number` | `1` | Number of I2C buses |
| `spiBusCount` | `number` | `1` | Number of SPI buses |
| `uartCount` | `number` | `1` | Number of UART serial ports |
| `uartRxBufferSize` | `number` | `256` | RX buffer size per UART port |
| `uartTxBufferSize` | `number` | `256` | TX buffer size per UART port |

### Board-Specific Defaults

| Board Type | Digital Pins | Analog Pins | PWM Pins | Interrupt Pins |
|------------|-------------|-------------|----------|----------------|
| `arduino-uno` | 14 | 6 | 3, 5, 6, 9, 10, 11 | 2, 3 |
| `arduino-nano` | 14 | 6 | 3, 5, 6, 9, 10, 11 | 2, 3 |
| *(other)* | 14 | 6 | 3, 5, 6, 9, 10, 11 | 2, 3 |

## SimBoard

The `SimBoard` class provides convenience accessors for all peripherals:

### Accessor Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `digital(pin)` | `SimDigitalPin` | Get digital pin by number (0–13). Throws if out of range. |
| `analog(pin)` | `SimAnalogPin` | Get analog pin by number (A0=0, A1=1, ...). Throws if out of range. |
| `pwm(pin)` | `SimPWMPin` | Get PWM pin by number. Throws if not a PWM-capable pin. |
| `interrupt(pin)` | `SimInterruptPin` | Get interrupt pin by number. Throws if not an interrupt pin. |
| `serial(port?)` | `SimSerialPort` | Get serial port (default: port 0 = UART0). Throws if not available. |
| `i2c(bus?)` | `SimI2CBus` | Get I2C bus (default: bus 0 = I2C0). Throws if not available. |
| `spi(bus?)` | `SimSPIBus` | Get SPI bus (default: bus 0 = SPI0). Throws if not available. |
| `reset()` | `void` | Reset all peripherals to initial state. |

### Direct Map Access

All peripherals are also available as `ReadonlyMap<number, T>` for iteration:

| Property | Type | Description |
|----------|------|-------------|
| `digitalPins` | `ReadonlyMap<number, SimDigitalPin>` | All digital pins |
| `analogPins` | `ReadonlyMap<number, SimAnalogPin>` | All analog pins |
| `pwmPins` | `ReadonlyMap<number, SimPWMPin>` | PWM-capable pins only |
| `interruptPins` | `ReadonlyMap<number, SimInterruptPin>` | Interrupt-capable pins only |
| `serialPorts` | `ReadonlyMap<number, SimSerialPort>` | All serial ports |
| `i2cBuses` | `ReadonlyMap<number, SimI2CBus>` | All I2C buses |
| `spiBuses` | `ReadonlyMap<number, SimSPIBus>` | All SPI buses |

## Examples

### Basic Board Creation

```typescript
import { createSimBoard } from '@typehal/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });

// Access peripherals
const led = board.digital(13);      // Built-in LED
const sensor = board.analog(0);     // A0
const pwm = board.pwm(9);           // PWM pin 9
const intPin = board.interrupt(2);  // Interrupt pin 2
const uart = board.serial(0);       // UART0
const i2c = board.i2c(0);           // I2C0
const spi = board.spi(0);           // SPI0
```

### Custom Pin Configuration

```typescript
// Create a board with more pins (e.g., Arduino Mega)
const mega = createSimBoard({
  boardType: 'arduino-mega',
  digitalPinCount: 54,
  analogPinCount: 16,
  uartCount: 4,
  i2cBusCount: 1,
  spiBusCount: 1,
});

mega.digital(53).asOutput();
mega.serial(3).begin(115200);
```

### Reset Between Tests

```typescript
describe('State machine tests', () => {
  const board = createSimBoard({ boardType: 'arduino-uno' });

  afterEach(() => {
    board.reset(); // Clears all pin states, buffers, and logs
  });

  it('test 1', () => {
    board.digital(13).high();
    // ...
  });

  it('test 2', () => {
    // Pin 13 is back to LOW after reset
    expect(board.digital(13).getBitValue()).toBe(0);
  });
});
```

### Error Handling for Invalid Pins

```typescript
const board = createSimBoard({ boardType: 'arduino-uno' });

// Digital pin 99 doesn't exist
expect(() => board.digital(99)).toThrow('Digital pin 99 not available');

// Pin 4 is not a PWM pin on Uno
expect(() => board.pwm(4)).toThrow('Pin 4 is not a PWM pin');

// Pin 7 is not an interrupt pin on Uno
expect(() => board.interrupt(7)).toThrow('Pin 7 is not an interrupt pin');
```

### Iterating All Pins

```typescript
const board = createSimBoard({ boardType: 'arduino-uno' });

// Reset all digital pins
for (const pin of board.digitalPins.values()) {
  pin.reset();
}

// Check all analog pins are at 0
for (const [num, pin] of board.analogPins) {
  expect(pin.read()).toBe(0);
}
```

## Testing Patterns

### Pattern: Extract Sketch Logic into Testable Functions

Since the simulator implements the same interfaces as real hardware, you can extract sketch logic into functions that accept HAL interfaces and test them with simulator instances:

```typescript
// sketch-logic.ts — shared between production and test
import type { IDigitalPin, ISerialPort } from '@typehal/core';

export function readAndReport(sensor: IDigitalPin, uart: ISerialPort): void {
  const value = sensor.read();
  uart.println(String(value));
}

// sketch.test.ts
import { createSimBoard } from '@typehal/simulator';
import { readAndReport } from './sketch-logic';

it('reads sensor and reports via serial', () => {
  const board = createSimBoard({ boardType: 'arduino-uno' });
  board.digital(2).injectValue(1);

  readAndReport(board.digital(2), board.serial(0));

  expect(board.serial(0).peekTxAsString()).toContain('1');
});
```

### Pattern: State Machine Testing

```typescript
interface TrafficLightState {
  red: SimDigitalPin;
  yellow: SimDigitalPin;
  green: SimDigitalPin;
}

function createTrafficLight(board: SimBoard): TrafficLightState {
  return {
    red: board.digital(2),
    yellow: board.digital(3),
    green: board.digital(4),
  };
}

it('cycles through traffic light states', () => {
  const board = createSimBoard({ boardType: 'arduino-uno' });
  const lights = createTrafficLight(board);

  // All off initially
  expect(lights.red.getBitValue()).toBe(0);
  expect(lights.green.getBitValue()).toBe(0);

  // Green phase
  lights.green.high();
  expect(lights.green.getBitValue()).toBe(1);

  // Yellow phase
  lights.green.low();
  lights.yellow.high();
  expect(lights.yellow.getBitValue()).toBe(1);

  // Red phase
  lights.yellow.low();
  lights.red.high();
  expect(lights.red.getBitValue()).toBe(1);
});
```
