// ---------------------------------------------------------------------------
// @typecode/core — Pin capability flags and narrowed capability types
// ---------------------------------------------------------------------------

/**
 * Ten boolean flags describing what a pin can do.
 * Every field must be explicitly set in board definitions
 * (omitting a field means the capability is absent).
 */
export interface PinCapabilityFlags {
  digitalInput: boolean;
  digitalOutput: boolean;
  analogInput: boolean;
  /** DAC output */
  analogOutput: boolean;
  pwm: boolean;
  interrupt: boolean;
  pullUp: boolean;
  pullDown: boolean;
  touch: boolean;
  openDrain: boolean;
}

// ---------------------------------------------------------------------------
// Narrowed capability types (used for branded pin exports)
// ---------------------------------------------------------------------------

export interface DigitalOnlyCapabilities extends PinCapabilityFlags {
  digitalInput: true;
  digitalOutput: true;
  analogInput: false;
  analogOutput: false;
  pwm: false;
  touch: false;
}

export interface PWMCapabilities extends PinCapabilityFlags {
  digitalInput: true;
  digitalOutput: true;
  pwm: true;
}

export interface AnalogInputCapabilities extends PinCapabilityFlags {
  analogInput: true;
}

export interface TouchCapabilities extends PinCapabilityFlags {
  touch: true;
}

// ---------------------------------------------------------------------------
// Conditional type helper
// ---------------------------------------------------------------------------

/** Checks at the type level whether T is a sub-type of U. */
export type SupportsCapabilities<T, U> = T extends U ? true : false;

// ---------------------------------------------------------------------------
// Runtime type guards
// ---------------------------------------------------------------------------

import type { IPin, IPWMPin, IAnalogInput, IInterruptPin, ITouchPin } from './pin';

/** Type guard to check if a value is an IPin (has required pin properties). */
function isIPin(value: unknown): value is IPin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    'gpio' in value &&
    'getMode' in value &&
    'setMode' in value
  );
}

/** Narrow an IPin to IPWMPin if it supports PWM. */
export function hasPWM(pin: unknown): pin is IPWMPin {
  return isIPin(pin) && 'setDutyCycle' in pin && 'setFrequency' in pin;
}

/** Narrow an IPin to IAnalogInput if it supports analog reads. */
export function hasAnalogInput(pin: unknown): pin is IAnalogInput {
  return isIPin(pin) && 'readVoltage' in pin && 'setReference' in pin;
}

/** Narrow an IPin to IInterruptPin if it supports interrupts. */
export function hasInterrupt(pin: unknown): pin is IInterruptPin {
  return isIPin(pin) && 'on' in pin && 'off' in pin && 'hasInterrupt' in pin;
}

/** Narrow an IPin to ITouchPin if it supports capacitive touch. */
export function hasTouch(pin: unknown): pin is ITouchPin {
  return isIPin(pin) && 'setThreshold' in pin && 'attachTouchInterrupt' in pin;
}

// ---------------------------------------------------------------------------
// Convenience aliases (more intuitive names)
// ---------------------------------------------------------------------------

/** Alias for hasPWM - checks if pin supports PWM output. */
export const isPWMPin = hasPWM;

/** Alias for hasAnalogInput - checks if pin supports analog reads. */
export const isAnalogPin = hasAnalogInput;

/** Alias for hasInterrupt - checks if pin supports interrupts. */
export const isInterruptPin = hasInterrupt;

/** Alias for hasTouch - checks if pin supports capacitive touch. */
export const isTouchPin = hasTouch;

// ---------------------------------------------------------------------------
// Assertion functions
// ---------------------------------------------------------------------------

/**
 * Assert that a pin supports PWM. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertPWM(pin: IPin, message?: string): asserts pin is IPWMPin {
  if (!hasPWM(pin)) {
    throw new Error(message ?? 'Pin does not support PWM');
  }
}

/**
 * Assert that a pin supports analog input. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertAnalog(pin: IPin, message?: string): asserts pin is IAnalogInput {
  if (!hasAnalogInput(pin)) {
    throw new Error(message ?? 'Pin does not support analog input');
  }
}

/**
 * Assert that a pin supports interrupts. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertInterrupt(pin: IPin, message?: string): asserts pin is IInterruptPin {
  if (!hasInterrupt(pin)) {
    throw new Error(message ?? 'Pin does not support interrupts');
  }
}
