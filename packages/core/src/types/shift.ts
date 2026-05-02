// ---------------------------------------------------------------------------
// @typehal/core — Shift register utilities
// ---------------------------------------------------------------------------

/** Minimal pin identity — accepts BasePin, IOutputModePin, IInputModePin, and board variants. */
type AnyPin = { readonly number: number; readonly gpio: number };

/** Bit transmission order */
export type ShiftBitOrder = 'msb' | 'lsb';

/**
 * Chainable shift read builder.
 */
interface IShiftReadChain {
  /** Set the clock pin */
  clock(pin: AnyPin): this;
  /** Read MSB first */
  msbFirst(): number;
  /** Read LSB first */
  lsbFirst(): number;
}

/**
 * Chainable shift write builder.
 */
interface IShiftWriteChain {
  /** Set the clock pin */
  clock(pin: AnyPin): this;
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
  in(dataPin: AnyPin, clockPin: AnyPin, bitOrder: ShiftBitOrder): number;

  /**
   * Shift data out to a pin.
   */
  out(dataPin: AnyPin, clockPin: AnyPin, bitOrder: ShiftBitOrder, value: number): void;

  // --- Fluent builders ---

  /** Start a fluent shift read chain */
  read(dataPin: AnyPin): IShiftReadChain;

  /** Start a fluent shift write chain */
  write(dataPin: AnyPin, value: number): IShiftWriteChain;
}

/** Stub for type checking. The transpiler replaces these with built-ins. */
declare const Shift: IShiftNamespace;

export { Shift };
