// ---------------------------------------------------------------------------
// @typecode/core — GPIO primitives, branded pin numbers, and digital values
// ---------------------------------------------------------------------------

/**
 * Branded pin number — prevents accidental use of arbitrary numbers
 * where a physical or GPIO pin number is expected.
 */
export type PinNumber = number & { readonly __pinNumber: unique symbol };

/** Helper to create a PinNumber from a plain number. */
export function pinNumber(n: number): PinNumber {
  return n as PinNumber;
}

// ---------------------------------------------------------------------------
// Digital value constants
// ---------------------------------------------------------------------------

/** Logical-high marker. */
export interface HIGH { readonly __high: unique symbol }
/** Logical-low marker. */
export interface LOW { readonly __low: unique symbol }

/** A digital value is a boolean **or** the branded HIGH / LOW literal. */
export type DigitalValue = HIGH | LOW | boolean;

/** An analog value is a plain number (resolution-dependent). */
export type AnalogValue = number;

export const HIGH: HIGH = Object.freeze({ __high: Symbol('HIGH') }) as unknown as HIGH;
export const LOW: LOW = Object.freeze({ __low: Symbol('LOW') }) as unknown as LOW;

// ---------------------------------------------------------------------------
// Pin mode
// ---------------------------------------------------------------------------

export enum PinMode {
  INPUT            = 'INPUT',
  OUTPUT           = 'OUTPUT',
  INPUT_PULLUP     = 'INPUT_PULLUP',
  INPUT_PULLDOWN   = 'INPUT_PULLDOWN',
  OUTPUT_OPEN_DRAIN = 'OUTPUT_OPEN_DRAIN',
  ANALOG           = 'ANALOG',
}

// ---------------------------------------------------------------------------
// Interrupt mode
// ---------------------------------------------------------------------------

export enum InterruptMode {
  RISING  = 'RISING',
  FALLING = 'FALLING',
  CHANGE  = 'CHANGE',
  LOW     = 'LOW',
  HIGH    = 'HIGH',
}

// ---------------------------------------------------------------------------
// GPIO configuration
// ---------------------------------------------------------------------------

import type { PinCapabilityFlags } from './capabilities';

export interface GPIOConfig {
  pin: PinNumber;
  gpio?: PinNumber;
  capabilities: PinCapabilityFlags;
  name?: string;
  peripheral?: string;
}

// ---------------------------------------------------------------------------
// GPIO pin factory
// ---------------------------------------------------------------------------

import type { IDigitalPin, IPWMPin, IAnalogInput, IPin } from './pin';

export interface IGPIOPinFactory {
  createDigitalPin(config: GPIOConfig): IDigitalPin;
  createPWMPin(config: GPIOConfig): IPWMPin;
  createAnalogPin(config: GPIOConfig): IAnalogInput;
  createPin(config: GPIOConfig): IPin;
}

// ---------------------------------------------------------------------------
// Pin groups
// ---------------------------------------------------------------------------

export interface IPinGroup<T extends IPin> {
  readonly name: string;
  readonly pins: ReadonlyArray<T>;
  writeAll(values: DigitalValue[]): void;
  readAll(): DigitalValue[];
}

import type { IDigitalPin as IDigitalPinType } from './pin';

export interface IParallelPort extends IPinGroup<IDigitalPinType> {
  writeByte(value: number): void;
  readByte(): number;
}
