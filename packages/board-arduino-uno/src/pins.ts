// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Typed pin exports
//
// Each pin is exported with the narrowest interface that matches its
// capabilities so that TypeScript prevents invalid operations at compile
// time (e.g. calling analogWrite on a digital-only pin).
//
// The factory stubs below capture pin/gpio numbers as plain data.  The
// transpiler replaces them with architecture-specific C++ during code-gen.
// ---------------------------------------------------------------------------

import type {
  BasePin,
  PWMPin,
  AnalogPin,
  InterruptPin,
} from '@typehal/core';
import type {
  IUnoDigitalPin,
  IUnoPWMPin,
  IUnoAnalogPin,
  IUnoInterruptPin,
} from './pin-types';

// ---------------------------------------------------------------------------
// Internal stub factories (no-op at runtime; consumed by transpiler)
// ---------------------------------------------------------------------------

import type { PinCapabilityFlags } from '@typehal/core';

const DIGITAL_CAPS: PinCapabilityFlags = {
  digitalInput: true, digitalOutput: true,
  analogInput: false, analogOutput: false,
  pwm: false, interrupt: false,
  pullUp: true, pullDown: false,
  touch: false, openDrain: false,
};

const PWM_CAPS: PinCapabilityFlags = {
  ...DIGITAL_CAPS,
  pwm: true,
};

const INTERRUPT_CAPS: PinCapabilityFlags = {
  ...DIGITAL_CAPS,
  interrupt: true,
};

const ANALOG_CAPS: PinCapabilityFlags = {
  ...DIGITAL_CAPS,
  analogInput: true,
};

function createDigitalPin(pin: number, gpio: number): IUnoDigitalPin {
  return {
    number: pin,
    gpio,
    capabilities: DIGITAL_CAPS,
  } as unknown as IUnoDigitalPin;
}

function createPWMPin(pin: number, gpio: number): IUnoPWMPin {
  return {
    number: pin,
    gpio,
    capabilities: PWM_CAPS,
  } as unknown as IUnoPWMPin;
}

function createInterruptPin(pin: number, gpio: number): IUnoInterruptPin {
  return {
    number: pin,
    gpio,
    capabilities: INTERRUPT_CAPS,
  } as unknown as IUnoInterruptPin;
}

function createAnalogPin(pin: number, gpio: number): IUnoAnalogPin {
  return {
    number: pin,
    gpio,
    capabilities: ANALOG_CAPS,
  } as unknown as IUnoAnalogPin;
}

// ---------------------------------------------------------------------------
// Digital-only pins (no PWM, no interrupt)
// ---------------------------------------------------------------------------

export const D4:  IUnoDigitalPin = createDigitalPin(4, 4);
export const D7:  IUnoDigitalPin = createDigitalPin(7, 7);
export const D8:  IUnoDigitalPin = createDigitalPin(8, 8);
export const D12: IUnoDigitalPin = createDigitalPin(12, 12);
export const D13: IUnoDigitalPin = createDigitalPin(13, 13);  // onboard LED

// ---------------------------------------------------------------------------
// Interrupt-capable digital pins (INT0 on D2, INT1 on D3)
// ---------------------------------------------------------------------------

export const D0: IUnoInterruptPin = createInterruptPin(0, 0);   // RX
export const D1: IUnoInterruptPin = createInterruptPin(1, 1);   // TX
export const D2: IUnoInterruptPin = createInterruptPin(2, 2);

// ---------------------------------------------------------------------------
// PWM pins
// ---------------------------------------------------------------------------

export const D3:  IUnoPWMPin = createPWMPin(3, 3);    // also INT1
export const D5:  IUnoPWMPin = createPWMPin(5, 5);
export const D6:  IUnoPWMPin = createPWMPin(6, 6);
export const D9:  IUnoPWMPin = createPWMPin(9, 9);
export const D10: IUnoPWMPin = createPWMPin(10, 10);
export const D11: IUnoPWMPin = createPWMPin(11, 11);

// ---------------------------------------------------------------------------
// Analog input pins (also support digital I/O)
// ---------------------------------------------------------------------------

export const A0: IUnoAnalogPin = createAnalogPin(14, 14);
export const A1: IUnoAnalogPin = createAnalogPin(15, 15);
export const A2: IUnoAnalogPin = createAnalogPin(16, 16);
export const A3: IUnoAnalogPin = createAnalogPin(17, 17);
export const A4: IUnoAnalogPin = createAnalogPin(18, 18);  // SDA
export const A5: IUnoAnalogPin = createAnalogPin(19, 19);  // SCL

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
