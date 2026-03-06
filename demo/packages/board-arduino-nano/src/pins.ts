// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano — Typed pin exports
//
// Each pin is exported with the narrowest interface that matches its
// capabilities so that TypeScript prevents invalid operations at compile
// time (e.g. calling analogWrite on a digital-only pin).
//
// The factory stubs below capture pin/gpio numbers as plain data.  The
// transpiler replaces them with architecture-specific C++ during code-gen.
// ---------------------------------------------------------------------------

import type {
  IDigitalPin,
  IPWMPin,
  IAnalogInput,
  IInterruptPin,
} from '@typecode/core';
import { pinNumber } from '@typecode/core';

// ---------------------------------------------------------------------------
// Internal stub factories (no-op at runtime; consumed by transpiler)
// ---------------------------------------------------------------------------

function createDigitalPin(pin: number, gpio: number): IDigitalPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin;
}

function createPWMPin(pin: number, gpio: number): IPWMPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IPWMPin;
}

function createAnalogPin(pin: number, gpio: number): IAnalogInput {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IAnalogInput;
}

function createInterruptPin(pin: number, gpio: number): IDigitalPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IInterruptPin;
}

// ---------------------------------------------------------------------------
// TODO: Define your board's pins below
// ---------------------------------------------------------------------------

// Example digital-only pins:
// export const D0: IDigitalPin = createDigitalPin(0, 0);
// export const D1: IDigitalPin = createDigitalPin(1, 1);

// Example PWM pins:
// export const D3: IPWMPin = createPWMPin(3, 3);

// Example analog input pins:
// export const A0: IAnalogInput = createAnalogPin(14, 14);

// Example interrupt-capable pins:
// export const D2: IDigitalPin & IInterruptPin = createInterruptPin(2, 2);

// ---------------------------------------------------------------------------
// Convenience aliases (uncomment and customize for your board)
// ---------------------------------------------------------------------------

// /** On-board LED. */
// export const LED = D13;

// /** I2C data line. */
// export const SDA = A4;
// /** I2C clock line. */
// export const SCL = A5;

// /** SPI master-out / slave-in. */
// export const MOSI = D11;
// /** SPI master-in / slave-out. */
// export const MISO = D12;
// /** SPI clock. */
// export const SCK = D13;
// /** SPI slave select. */
// export const SS = D10;

// /** UART transmit. */
// export const TX = D1;
// /** UART receive. */
// export const RX = D0;
