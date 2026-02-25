// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Typed pin exports
//
// Arduino NANO 33 IoT — SAMD21G18A (ARM Cortex-M0+ @ 48 MHz)
//
// The SAMD21 supports external interrupts on virtually all I/O pins.
// Nearly all digital pins also support PWM via the TC/TCC timer peripherals.
// The ADC is 12-bit (vs 10-bit on AVR).
//
// Each pin is exported with the narrowest interface that matches its
// capabilities so that TypeScript prevents invalid operations at compile
// time.  Factory stubs return `number` so the transpiler emits `int` in C++.
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

function createInterruptPin(pin: number, gpio: number): IDigitalPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IInterruptPin;
}

function createPWMPin(pin: number, gpio: number): IPWMPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IPWMPin & IInterruptPin;
}

function createAnalogPin(pin: number, gpio: number): IAnalogInput {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IAnalogInput;
}

// ---------------------------------------------------------------------------
// Digital + interrupt-capable pins
// (SAMD21 routes all external interrupts through its EIC; D0/D1 = UART)
// ---------------------------------------------------------------------------

/** D0 / RX — UART0 receive. */
export const D0:  IDigitalPin & IInterruptPin = createInterruptPin(0, 0);
/** D1 / TX — UART0 transmit. */
export const D1:  IDigitalPin & IInterruptPin = createInterruptPin(1, 1);

// ---------------------------------------------------------------------------
// PWM + interrupt-capable pins
// (All D2–D12 support PWM and external interrupts on the SAMD21)
// ---------------------------------------------------------------------------

/** D2 — PWM + interrupt. */
export const D2:  IPWMPin & IInterruptPin = createPWMPin(2, 2);
/** D3 — PWM + interrupt. */
export const D3:  IPWMPin & IInterruptPin = createPWMPin(3, 3);
/** D4 — PWM + interrupt. */
export const D4:  IPWMPin & IInterruptPin = createPWMPin(4, 4);
/** D5 — PWM + interrupt. */
export const D5:  IPWMPin & IInterruptPin = createPWMPin(5, 5);
/** D6 — PWM + interrupt. */
export const D6:  IPWMPin & IInterruptPin = createPWMPin(6, 6);
/** D7 — PWM + interrupt. */
export const D7:  IPWMPin & IInterruptPin = createPWMPin(7, 7);
/** D8 — PWM + interrupt. */
export const D8:  IPWMPin & IInterruptPin = createPWMPin(8, 8);
/** D9 — PWM + interrupt. */
export const D9:  IPWMPin & IInterruptPin = createPWMPin(9, 9);
/** D10 / SS — SPI chip-select, PWM + interrupt. */
export const D10: IPWMPin & IInterruptPin = createPWMPin(10, 10);
/** D11 / MOSI — SPI MOSI, PWM + interrupt. */
export const D11: IPWMPin & IInterruptPin = createPWMPin(11, 11);
/** D12 / MISO — SPI MISO, interrupt-capable. */
export const D12: IDigitalPin & IInterruptPin = createInterruptPin(12, 12);
/** D13 / SCK / LED — SPI clock, on-board LED. */
export const D13: IDigitalPin = createDigitalPin(13, 13);

// ---------------------------------------------------------------------------
// Analog input pins (12-bit ADC, pin numbers 14–21)
// ---------------------------------------------------------------------------

/** A0 — Analog input (also DAC output on SAMD21). */
export const A0: IAnalogInput = createAnalogPin(14, 14);
/** A1 — Analog input. */
export const A1: IAnalogInput = createAnalogPin(15, 15);
/** A2 — Analog input. */
export const A2: IAnalogInput = createAnalogPin(16, 16);
/** A3 — Analog input. */
export const A3: IAnalogInput = createAnalogPin(17, 17);
/** A4 / SDA — Analog input + I2C data. */
export const A4: IAnalogInput = createAnalogPin(18, 18);
/** A5 / SCL — Analog input + I2C clock. */
export const A5: IAnalogInput = createAnalogPin(19, 19);
/** A6 — Analog input. */
export const A6: IAnalogInput = createAnalogPin(20, 20);
/** A7 — Analog input. */
export const A7: IAnalogInput = createAnalogPin(21, 21);

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
/** SPI slave-select / chip-select (D10). */
export const SS   = D10;

/** UART0 transmit (D1). */
export const TX   = D1;
/** UART0 receive (D0). */
export const RX   = D0;
