// ---------------------------------------------------------------------------
// @typecode/core — Shift register utilities
// ---------------------------------------------------------------------------

import type { IPin } from './pin';

/** Bit transmission order */
export type ShiftBitOrder = 'msb' | 'lsb';

/**
 * Chainable shift read builder.
 */
export interface IShiftReadChain {
  /** Set the clock pin */
  clock(pin: IPin): this;
  /** Read MSB first */
  msbFirst(): number;
  /** Read LSB first */
  lsbFirst(): number;
}

/**
 * Chainable shift write builder.
 */
export interface IShiftWriteChain {
  /** Set the clock pin */
  clock(pin: IPin): this;
  /** Write MSB first */
  msbFirst(): void;
  /** Write LSB first */
  lsbFirst(): void;
}

/**
 * Shift register namespace with both direct and fluent APIs.
 */
export interface IShiftNamespace {
  // --- Direct functions ---

  /**
   * Shift data in from a pin.
   */
  in(dataPin: IPin, clockPin: IPin, bitOrder: ShiftBitOrder): number;

  /**
   * Shift data out to a pin.
   */
  out(dataPin: IPin, clockPin: IPin, bitOrder: ShiftBitOrder, value: number): void;

  // --- Fluent builders ---

  /** Start a fluent shift read chain */
  read(dataPin: IPin): IShiftReadChain;

  /** Start a fluent shift write chain */
  write(dataPin: IPin, value: number): IShiftWriteChain;
}

/** Stub for type checking. The transpiler replaces these with built-ins. */
declare const Shift: IShiftNamespace;

export { Shift };
