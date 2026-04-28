# @typehal/simulator

Node.js hardware simulation runtime for TypeHAL.

## Overview

`@typehal/simulator` provides a simulated hardware runtime for TypeHAL firmware and tests. It exposes simulated GPIO pins, serial ports, I2C buses, SPI buses, PWM pins, and interrupt pins so you can verify hardware logic without using a physical board.

## When to use the simulator

`@typehal/simulator` is best for testing and validating hardware-facing logic in Node.js before you use a real board. It is not a transpiler output checker, and it does not replace `@typehal/expect` for firmware-level hardware tests.

Use the simulator when you want to:

- unit test control logic for buttons, LEDs, and buses
- verify that a parser sends the correct serial bytes
- mock sensor input through analog or I2C injection
- exercise interrupt-driven code paths without physical hardware
- run CI-friendly tests that are fast and deterministic

Do not use it for:

- verifying TypeHAL transpilation output
- measuring real ADC noise or analog timing
- checking exact microsecond timing behavior

## Quick start

```ts
import { createSimBoard } from '@typehal/simulator';

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
import { createSimBoard } from '@typehal/simulator';

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

- `boardType` — common board identifier such as `arduino-uno`
- `digitalPinCount` — number of digital pins
- `analogPinCount` — number of analog pins
- `uartCount` — number of serial ports
- `i2cBusCount` — number of I2C buses
- `spiBusCount` — number of SPI buses

### Access simulated peripherals

The `SimBoard` instance exposes typed accessors:

- `board.digital(pin)` — `SimDigitalPin`
- `board.analog(pin)` — `SimAnalogPin`
- `board.pwm(pin)` — `SimPWMPin`
- `board.interrupt(pin)` — `SimInterruptPin`
- `board.serial(port)` — `SimSerialPort`
- `board.i2c(bus)` — `SimI2CBus`
- `board.spi(bus)` — `SimSPIBus`

### Verify state and reset

The simulated board supports reset and state inspection, making it useful for unit tests and firmware validation without hardware:

```ts
board.digital(13).output();
board.digital(13).high();
expect(board.digital(13).getBitValue()).toBe(1);
board.reset();
expect(board.digital(13).getBitValue()).toBe(0);
```

### TypeHAL HAL compatibility

`@typehal/simulator` is built on the same TypeHAL hardware abstraction contract used by the rest of the ecosystem. The simulator implementations use `@typehal/core` interfaces and value types to model hardware behavior:

- `SimDigitalPin` implements `BasePin` and digital pin semantics.
- `SimAnalogPin` implements `AnalogPin` semantics.
- `SimPWMPin` implements `PWMPin` semantics.
- `SimInterruptPin` implements `InterruptPin` semantics.
- `SimSerialPort` implements `ISerialPort` / UART communication semantics.
- `SimI2CBus` and `SimSPIBus` expose the same bus-style APIs expected by TypeHAL HAL consumers.

The simulator package does not currently import board definition metadata from `@typehal/hal` directly. Instead, it mirrors the HAL/framework contract through shared `@typehal/core` interfaces and the same peripheral method names, so test code can use simulated hardware with the same API shape as firmware running on a real board.

### How the simulator uses TypeHAL HAL concepts

- `PinMode` values are imported from `@typehal/core` and used to track simulated pin direction and pull state.
- capability flags like `digitalInput`, `pwm`, and `interrupt` are modeled using the same type definitions that HAL packages expose for pin capabilities.
- serial, I2C, and SPI simulation classes rely on the shared TypeHAL bus interfaces to ensure host code can interact with them using the same method names and semantics as real hardware.
- `createSimBoard()` selects default PWM and interrupt pin sets by board type, matching the physical pin layout conventions used by TypeHAL board packages such as `@typehal/board-arduino-uno`.

This makes the simulator a practical way to validate hardware logic and unit tests while staying aligned with TypeHAL’s HAL abstraction layer.
