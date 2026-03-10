// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Typed pin exports
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

function createInterruptPin(pin: number, gpio: number): IDigitalPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IInterruptPin;
}

function createAnalogPin(pin: number, gpio: number): IDigitalPin & IAnalogInput {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IAnalogInput;
}

// ---------------------------------------------------------------------------
// Digital-only pins (no PWM, no interrupt)
// ---------------------------------------------------------------------------

export const D4:  IDigitalPin = createDigitalPin(4, 4);
export const D7:  IDigitalPin = createDigitalPin(7, 7);
export const D8:  IDigitalPin = createDigitalPin(8, 8);
export const D12: IDigitalPin = createDigitalPin(12, 12);
export const D13: IDigitalPin = createDigitalPin(13, 13);  // onboard LED

// ---------------------------------------------------------------------------
// Interrupt-capable digital pins (INT0 on D2, INT1 on D3)
// ---------------------------------------------------------------------------

export const D0: IDigitalPin & IInterruptPin = createInterruptPin(0, 0);   // RX
export const D1: IDigitalPin & IInterruptPin = createInterruptPin(1, 1);   // TX
export const D2: IDigitalPin & IInterruptPin = createInterruptPin(2, 2);

// ---------------------------------------------------------------------------
// PWM pins
// ---------------------------------------------------------------------------

export const D3:  IPWMPin = createPWMPin(3, 3);    // also INT1
export const D5:  IPWMPin = createPWMPin(5, 5);
export const D6:  IPWMPin = createPWMPin(6, 6);
export const D9:  IPWMPin = createPWMPin(9, 9);
export const D10: IPWMPin = createPWMPin(10, 10);
export const D11: IPWMPin = createPWMPin(11, 11);

// ---------------------------------------------------------------------------
// Analog input pins (also support digital I/O)
// ---------------------------------------------------------------------------

export const A0: IDigitalPin & IAnalogInput = createAnalogPin(14, 14);
export const A1: IDigitalPin & IAnalogInput = createAnalogPin(15, 15);
export const A2: IDigitalPin & IAnalogInput = createAnalogPin(16, 16);
export const A3: IDigitalPin & IAnalogInput = createAnalogPin(17, 17);
export const A4: IDigitalPin & IAnalogInput = createAnalogPin(18, 18);  // SDA
export const A5: IDigitalPin & IAnalogInput = createAnalogPin(19, 19);  // SCL

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

/** On-board LED (D13). */
export const LED  = D13;

/** I2C data line (A4). */
export const SDA  = A4;
/** I2C clock line (A5). */
export const SCL  = A5;

/** SPI master-out / slave-in (D11). */
export const MOSI = D11;
/** SPI master-in / slave-out (D12). */
export const MISO = D12;
/** SPI clock (D13). */
export const SCK  = D13;
/** SPI slave select (D10). */
export const SS   = D10;

/** UART transmit (D1). */
export const TX   = D1;
/** UART receive (D0). */
export const RX   = D0;
