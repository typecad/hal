// ---------------------------------------------------------------------------
// @typehal/core — Pin capability flags and narrowed capability types
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

import type { BasePin, PWMPin, AnalogPin, InterruptPin } from './pin';

/** Type guard to check if a value is a BasePin (has required pin properties). */
function isBasePin(value: unknown): value is BasePin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'number' in value &&
    'gpio' in value
  );
}

/** Narrow a BasePin to PWMPin if it supports PWM. */
export function hasPWM(pin: unknown): pin is PWMPin {
  return isBasePin(pin) && 'pwm' in pin && typeof pin.pwm === 'function';
}

/** Narrow a BasePin to AnalogPin if it supports analog reads. */
export function hasAnalogInput(pin: unknown): pin is AnalogPin {
  return isBasePin(pin) && 'readAnalog' in pin && typeof pin.readAnalog === 'function';
}

/** Narrow a BasePin to InterruptPin if it supports interrupts. */
export function hasInterrupt(pin: unknown): pin is InterruptPin {
  return isBasePin(pin) && 'onRising' in pin && typeof pin.onRising === 'function';
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

// ---------------------------------------------------------------------------
// Assertion functions
// ---------------------------------------------------------------------------

/**
 * Assert that a pin supports PWM. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertPWM(pin: BasePin, message?: string): asserts pin is PWMPin {
  if (!hasPWM(pin)) {
    throw new Error(message ?? 'Pin does not support PWM');
  }
}

/**
 * Assert that a pin supports analog input. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertAnalog(pin: BasePin, message?: string): asserts pin is AnalogPin {
  if (!hasAnalogInput(pin)) {
    throw new Error(message ?? 'Pin does not support analog input');
  }
}

/**
 * Assert that a pin supports interrupts. Throws at runtime if not.
 * Useful for fail-fast validation in setup code.
 */
export function assertInterrupt(pin: BasePin, message?: string): asserts pin is InterruptPin {
  if (!hasInterrupt(pin)) {
    throw new Error(message ?? 'Pin does not support interrupts');
  }
}
