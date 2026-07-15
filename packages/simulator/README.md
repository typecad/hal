# @typecad/simulator

Node.js hardware simulation runtime for TypeCAD.

## Overview

`@typecad/simulator` provides a simulated hardware runtime for TypeCAD firmware and tests. It exposes simulated GPIO pins, serial ports, I2C buses, SPI buses, PWM pins, and interrupt pins so you can verify hardware logic without using a physical board.

## When to use the simulator

`@typecad/simulator` is best for testing and validating hardware-facing logic in Node.js before you use a real board. It is not a transpiler output checker, and it does not replace `@typecad/expect` for firmware-level hardware tests.

Use the simulator when you want to:

- unit test control logic for buttons, LEDs, and buses
- verify that a parser sends the correct serial bytes
- mock sensor input through analog or I2C injection
- exercise interrupt-driven code paths without physical hardware
- run CI-friendly tests that are fast and deterministic

Do not use it for:

- verifying TypeCAD transpilation output
- measuring real ADC noise or analog timing
- checking exact microsecond timing behavior

## Quick start

```ts
import { createSimBoard } from '@typecad/simulator';

const board = createSimBoard({ boardType: 'arduino-uno' });

const button = board.digital(2).asInputPullUp();
const led = board.digital(13).asOutput();

button.injectValue(0); // simulate a pressed active-low button
if (!button.read()) {
  led.high();
}

console.log(led.getBitValue()); // 1
```

## Example: button-driven LED logic

This pattern is the real value of the simulator: you can test logic driven by external inputs without a board.

```ts
import { describe, it, expect } from 'vitest';
import { createSimBoard } from '@typecad/simulator';

function updateLed(button: any, led: any) {
  if (!button.read()) {
    led.high();
  } else {
    led.low();
  }
}

describe('button toggle logic', () => {
  it('turns the LED on when the button is pressed', () => {
    const board = createSimBoard({ boardType: 'arduino-uno' });
    const button = board.digital(2).asInputPullUp();
    const led = board.digital(13).asOutput();

    button.injectValue(0); // press button
    updateLed(button, led);

    expect(led.getBitValue()).toBe(1);
  });
});
```

## How to use

### Create a simulated board

Use `createSimBoard()` with a board type and optional custom counts:

- `boardType` — board identifier such as `arduino-uno` or `arduino-nano`. Known board types carry default PWM/interrupt pin maps; custom/unknown types have no capability pins unless declared via `pwmPins`/`interruptPins`.
- `digitalPinCount` — number of digital pins
- `analogPinCount` — number of analog pins
- `uartCount` — number of serial ports
- `i2cBusCount` — number of I2C buses
- `spiBusCount` — number of SPI buses
- `pwmPins` / `interruptPins` — override the capability pin numbers (defaults to the board type's map, or empty for custom boards)

### Access simulated peripherals

The `SimBoard` instance exposes typed accessors:

- `board.digital(pin)` — `SimDigitalPin`
- `board.analog(pin)` — `SimAnalogPin`
- `board.pwm(pin)` — `SimPWMPin`
- `board.interrupt(pin)` — `SimInterruptPin`
- `board.serial(port)` — `SimSerialPort`
- `board.i2c(bus)` — `SimI2CBus`
- `board.spi(bus)` — `SimSPIBus`

### Simulating a real board package

When you already depend on a `@typecad/board-*` package, use `createBoardFromDefinition()` to build a `SimBoard` whose pin layout, PWM/interrupt pins, ADC resolution/reference, and bus counts match the real board — instead of hardcoding them in `createSimBoard()`:

```ts
import { ArduinoUno } from '@typecad/board-arduino-uno';
import { createBoardFromDefinition } from '@typecad/simulator';

const board = createBoardFromDefinition(ArduinoUno);

board.digital(13).asOutput().high();   // LED on PB5 (pin 13)
board.pwm(9).pwm(50);                  // PWM on PB1 (pin 9)
board.analog(0).injectVoltage(2.5);    // A0, 10-bit ADC, 5V reference
```

This is the recommended path for board-specific tests. The board package must be built so its `BoardDefinition` is importable at runtime. See the [Software-Defined Hardware docs](https://cuttlefish.typecad.net/docs/simulation/software-defined-hardware#simulating-a-real-board-package) for the full list of derived fields.

### Verify state and reset

The simulated board supports reset and state inspection, making it useful for unit tests and firmware validation without hardware:

```ts
board.digital(13).output();
board.digital(13).high();
expect(board.digital(13).getBitValue()).toBe(1);
board.reset();
expect(board.digital(13).getBitValue()).toBe(0);
```

### HAL compatibility

`@typecad/simulator` is built on the same hardware abstraction contract used by the rest of the ecosystem. The simulator package owns the runtime contract hierarchy (`BasePin`, `PWMPin`, `AnalogPin`, `InterruptPin`, `II2CBus`, `ISPIBus`, `ISerialPort`, and the `I2CStatus`/`SPIStatus`/`UARTStatus` enums) in its own `contracts.ts`, and re-exports it for consumers. Primitive and protocol-shape types (`PinMode`, `DigitalValue`, `AnalogValue`, `InterruptHandler`, `I2CAddress`, `SPIMode`, `SPIBitOrder`, `SPISettings`) are imported from `@typecad/hal`:

- `SimDigitalPin` implements `BasePin` and digital pin semantics.
- `SimAnalogPin` implements `AnalogPin` semantics.
- `SimPWMPin` implements `PWMPin` semantics (including `getPwmFrequency()` / `getPwmResolution()`).
- `SimInterruptPin` implements `InterruptPin` semantics.
- `SimSerialPort` implements `ISerialPort` / UART communication semantics.
- `SimI2CBus` and `SimSPIBus` expose the same bus-style APIs expected by TypeCAD HAL consumers.

### How the simulator uses HAL concepts

- `PinMode` values are imported from `@typecad/hal` and used to track simulated pin direction and pull state.
- capability flags like `digitalInput`, `pwm`, and `interrupt` are modeled using the same type definitions that HAL packages expose for pin capabilities.
- serial, I2C, and SPI simulation classes rely on the shared TypeCAD bus interfaces to ensure host code can interact with them using the same method names and semantics as real hardware.
- `createSimBoard()` selects default PWM and interrupt pin sets by board type, matching the physical pin layout conventions used by TypeCAD board packages.

This makes the simulator a practical way to validate hardware logic and unit tests while staying aligned with TypeCAD's HAL abstraction layer.
