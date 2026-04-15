// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Board-specific pin type overrides
//
// AVR (ATmega328P) has no hardware pulldown, so we exclude `inputPullDown()`.
// TypeScript autocomplete will not show it on any Uno pin.
// ---------------------------------------------------------------------------

import type { BasePin, IOutputModePin, IInputModePin, PWMPin, AnalogPin, InterruptPin } from '@typecode/core';

/** Digital pin on Arduino Uno — no hardware pulldown. */
export type IUnoDigitalPin = Omit<BasePin, 'inputPullDown'>;

/** PWM pin on Arduino Uno — no hardware pulldown. */
export type IUnoPWMPin = Omit<BasePin, 'inputPullDown'> & {
  pwm: NonNullable<BasePin['pwm']>;
  getPwmFrequency: NonNullable<BasePin['getPwmFrequency']>;
  getPwmResolution: NonNullable<BasePin['getPwmResolution']>;
};

/** Analog pin on Arduino Uno — no hardware pulldown. */
export type IUnoAnalogPin = Omit<BasePin, 'inputPullDown'> & {
  readAnalog: NonNullable<BasePin['readAnalog']>;
  readVoltage: NonNullable<BasePin['readVoltage']>;
  setAnalogReference: NonNullable<BasePin['setAnalogReference']>;
  getAnalogResolution: NonNullable<BasePin['getAnalogResolution']>;
};

/** Interrupt-capable pin on Arduino Uno — no hardware pulldown. */
export type IUnoInterruptPin = Omit<BasePin, 'inputPullDown'> & {
  onRising: NonNullable<BasePin['onRising']>;
  onFalling: NonNullable<BasePin['onFalling']>;
  onChange: NonNullable<BasePin['onChange']>;
  offInterrupts: NonNullable<BasePin['offInterrupts']>;
};

// ---------------------------------------------------------------------------
// Mode-restricted pin types (AVR — no hardware pulldown)
// ---------------------------------------------------------------------------

/** Output-mode pin on Arduino Uno — no hardware pulldown. */
export type IUnoOutputModePin = Omit<IOutputModePin, 'inputPullDown'>;

/** Input-mode pin on Arduino Uno — no hardware pulldown. */
export type IUnoInputModePin = Omit<IInputModePin, 'inputPullDown'>;
