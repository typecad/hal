// ---------------------------------------------------------------------------
// @typehal/core — GPIO primitives and digital values
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Digital value constants
// ---------------------------------------------------------------------------

/** Logical-high — alias for `true`. */
export const HIGH = true;
/** Logical-low — alias for `false`. */
export const LOW = false;

/** A digital value is a plain boolean. */
export type DigitalValue = boolean;

/** An analog value is a plain number (resolution-dependent). */
export type AnalogValue = number;

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

interface GPIOConfig {
  pin: number;
  gpio?: number;
  capabilities: PinCapabilityFlags;
  name?: string;
  peripheral?: string;
}

// ---------------------------------------------------------------------------
// Pin groups
// ---------------------------------------------------------------------------

import type { BasePin } from './pin';

/**
 * A group of digital output pins that can be controlled together.
 */
export interface IPinGroup<T extends BasePin = BasePin> {
  readonly name: string;
  readonly pins: ReadonlyArray<T>;
  /** Write a bitmask to the group (bit 0 = first pin). */
  writePattern(pattern: number): void;
  /** Read current state as a bitmask (bit 0 = first pin). */
  readPattern(): number;
  /** Set all pins to the same value. */
  fill(value: DigitalValue): void;
}

/**
 * A parallel port for byte-level operations on 8 digital pins.
 */
interface IParallelPort extends IPinGroup<BasePin> {
  /** Write a byte value (alias for writePattern). */
  writeByte(value: number): void;
  /** Read a byte value (alias for readPattern). */
  readByte(): number;
}

// ---------------------------------------------------------------------------
// Pin group factory
// ---------------------------------------------------------------------------

/**
 * Create a pin group for bulk operations on multiple pins.
 * @param pins - Array of pins to include in the group
 */
export function createPinGroup<T extends BasePin>(
  pins: T[]
): IPinGroup<T> {
  return {
    name: 'PinGroup',
    pins: Object.freeze(pins) as ReadonlyArray<T>,

    writePattern(pattern: number): void {
      for (let i = 0; i < this.pins.length; i++) {
        const bit = (pattern >> i) & 1;
        const pin = this.pins[i];
        if ('write' in pin && typeof pin.write === 'function') {
          pin.write(bit === 1);
        }
      }
    },

    readPattern(): number {
      let value = 0;
      for (let i = 0; i < this.pins.length; i++) {
        const pin = this.pins[i];
        if ('isHigh' in pin && typeof pin.isHigh === 'function' && pin.isHigh()) {
          value |= (1 << i);
        }
      }
      return value;
    },

    fill(value: DigitalValue): void {
      for (const pin of this.pins) {
        if ('write' in pin && typeof pin.write === 'function') {
          pin.write(value);
        }
      }
    },
  };
}

