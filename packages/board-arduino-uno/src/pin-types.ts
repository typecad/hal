// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Board-specific pin type overrides
//
// AVR (ATmega328P) has no hardware pulldown, so we exclude `inputPullDown()`.
// Capability-specific methods (analog, PWM, interrupt) are omitted from pin
// types that don't support them, so TypeScript reports "Property 'readAnalog'
// does not exist" instead of the unhelpful "Object is possibly undefined".
// ---------------------------------------------------------------------------

import type { BasePin, IOutputModePin, IInputModePin, PWMPin, AnalogPin, InterruptPin } from '@typehal/core';

// ---------------------------------------------------------------------------
// Method groups — used to cleanly Omit capability methods from pin types
// that don't support them.
// ---------------------------------------------------------------------------

/** Methods only available on analog-capable pins (A0-A5). */
type AnalogMethods = 'readAnalog' | 'readVoltage' | 'setAnalogReference' | 'getAnalogResolution';

/** Methods only available on PWM-capable pins (D3, D5, D6, D9, D10, D11). */
type PWMMethods = 'pwm' | 'getPwmFrequency' | 'getPwmResolution';

/** Methods only available on interrupt-capable pins (D0, D1, D2). */
type InterruptMethods = 'onRising' | 'onFalling' | 'onChange' | 'offInterrupts';

/** Not supported on AVR (ATmega328P) hardware. */
type UnsupportedOnAVR = 'inputPullDown';

// ---------------------------------------------------------------------------
// Pin types
// ---------------------------------------------------------------------------

/** Digital-only pin (D4, D7, D8, D12, D13) — no analog, PWM, or interrupts. */
export type IUnoDigitalPin = Omit<BasePin, UnsupportedOnAVR | AnalogMethods | PWMMethods | InterruptMethods>;

/** PWM pin (D3, D5, D6, D9, D10, D11) — no analog or interrupts. */
export type IUnoPWMPin = Omit<BasePin, UnsupportedOnAVR | AnalogMethods | InterruptMethods> & {
  pwm: NonNullable<BasePin['pwm']>;
  getPwmFrequency: NonNullable<BasePin['getPwmFrequency']>;
  getPwmResolution: NonNullable<BasePin['getPwmResolution']>;
};

/** Analog pin (A0-A5) — no PWM or interrupts. */
export type IUnoAnalogPin = Omit<BasePin, UnsupportedOnAVR | PWMMethods | InterruptMethods> & {
  readAnalog: NonNullable<BasePin['readAnalog']>;
  readVoltage: NonNullable<BasePin['readVoltage']>;
  setAnalogReference: NonNullable<BasePin['setAnalogReference']>;
  getAnalogResolution: NonNullable<BasePin['getAnalogResolution']>;
};

/** Interrupt-capable pin (D0, D1, D2) — no analog or PWM. */
export type IUnoInterruptPin = Omit<BasePin, UnsupportedOnAVR | AnalogMethods | PWMMethods> & {
  onRising: NonNullable<BasePin['onRising']>;
  onFalling: NonNullable<BasePin['onFalling']>;
  onChange: NonNullable<BasePin['onChange']>;
  offInterrupts: NonNullable<BasePin['offInterrupts']>;
};

// ---------------------------------------------------------------------------
// Mode-restricted pin types (AVR — no hardware pulldown)
// ---------------------------------------------------------------------------

/** Output-mode pin on Arduino Uno — no hardware pulldown or analog/interrupt methods. */
export type IUnoOutputModePin = Omit<IOutputModePin, UnsupportedOnAVR | AnalogMethods | InterruptMethods>;

/** Input-mode pin on Arduino Uno — no hardware pulldown or PWM methods. */
export type IUnoInputModePin = Omit<IInputModePin, UnsupportedOnAVR | PWMMethods>;
