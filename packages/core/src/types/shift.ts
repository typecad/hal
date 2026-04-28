// ---------------------------------------------------------------------------
// @typehal/core — Shift register utilities
// ---------------------------------------------------------------------------

import type { BasePin } from './pin';

/** Bit transmission order */
export type ShiftBitOrder = 'msb' | 'lsb';

/**
 * Chainable shift read builder.
 */
export interface IShiftReadChain {
  /** Set the clock pin */
  clock(pin: BasePin): this;
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
  clock(pin: BasePin): this;
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
  in(dataPin: BasePin, clockPin: BasePin, bitOrder: ShiftBitOrder): number;

  /**
   * Shift data out to a pin.
   */
  out(dataPin: BasePin, clockPin: BasePin, bitOrder: ShiftBitOrder, value: number): void;

  // --- Fluent builders ---

  /** Start a fluent shift read chain */
  read(dataPin: BasePin): IShiftReadChain;

  /** Start a fluent shift write chain */
  write(dataPin: BasePin, value: number): IShiftWriteChain;
}

/** Stub for type checking. The transpiler replaces these with built-ins. */
declare const Shift: IShiftNamespace;

export { Shift };
