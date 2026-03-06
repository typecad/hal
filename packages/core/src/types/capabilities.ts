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

/** Narrow an IPin to IPWMPin if it supports PWM. */
export function hasPWM(pin: IPin): pin is IPWMPin {
  return 'setDutyCycle' in pin && 'setFrequency' in pin;
}

/** Narrow an IPin to IAnalogInput if it supports analog reads. */
export function hasAnalogInput(pin: IPin): pin is IAnalogInput {
  return 'readVoltage' in pin && 'setReference' in pin;
}

/** Narrow an IPin to IInterruptPin if it supports interrupts. */
export function hasInterrupt(pin: IPin): pin is IInterruptPin {
  return 'on' in pin && 'off' in pin && 'hasInterrupt' in pin;
}

/** Narrow an IPin to ITouchPin if it supports capacitive touch. */
export function hasTouch(pin: IPin): pin is ITouchPin {
  return 'setThreshold' in pin && 'attachTouchInterrupt' in pin;
}
