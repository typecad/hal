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

export interface IParallelPort extends IPinGroup<IDigitalPin> {
  writeByte(value: number): void;
  readByte(): number;
}

// ---------------------------------------------------------------------------
// Pin group factory
// ---------------------------------------------------------------------------

/**
 * Create a pin group for bulk operations on multiple pins.
 * @param name - A descriptive name for the group
 * @param pins - Array of pins to include in the group
 */
export function createPinGroup<T extends IPin>(
  name: string,
  pins: T[]
): IPinGroup<T> {
  return {
    name,
    pins: Object.freeze(pins) as ReadonlyArray<T>,
    
    writeAll(values: DigitalValue[]): void {
      for (let i = 0; i < this.pins.length && i < values.length; i++) {
        const pin = this.pins[i];
        if ('write' in pin && typeof pin.write === 'function') {
          pin.write(values[i]);
        }
      }
    },
    
    readAll(): DigitalValue[] {
      return this.pins.map(pin => {
        if ('read' in pin && typeof pin.read === 'function') {
          return pin.read();
        }
        return false;
      });
    },
  };
}

/**
 * Create a parallel port for byte-level operations on 8 digital pins.
 * @param name - A descriptive name for the port
 * @param pins - Exactly 8 digital pins (LSB first)
 */
export function createParallelPort(
  name: string,
  pins: [IDigitalPin, IDigitalPin, IDigitalPin, IDigitalPin, IDigitalPin, IDigitalPin, IDigitalPin, IDigitalPin]
): IParallelPort {
  const group = createPinGroup(name, pins);
  
  return {
    ...group,
    
    writeByte(value: number): void {
      for (let i = 0; i < 8; i++) {
        const bit = (value >> i) & 1;
        this.pins[i].write(bit === 1);
      }
    },
    
    readByte(): number {
      let value = 0;
      for (let i = 0; i < 8; i++) {
        if (this.pins[i].isHigh()) {
          value |= (1 << i);
        }
      }
      return value;
    },
  };
}
