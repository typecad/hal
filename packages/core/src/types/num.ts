// ---------------------------------------------------------------------------
// @typecode/core — Fluent number utilities (map, constrain, min, max, abs)
//
// Provides both Arduino-compatible direct functions and fluent chainable API.
// ---------------------------------------------------------------------------

/**
 * Chainable map builder - collects from/to ranges then computes result.
 */
export interface INumMapChain {
  /** Set the input range */
  from(low: number, high: number): this;
  /** Set the output range and compute the result */
  to(low: number, high: number): number;
  /** Convenience: map to 0-100 percent range */
  toPercent(): number;
  /** Convenience: map to 0-255 byte range */
  toByte(): number;
  /** Chain into constrain operation */
  constrain(): INumConstrainChain;
}

/**
 * Chainable constrain builder - collects bounds then constrains value.
 */
export interface INumConstrainChain {
  /** Set the bounds and constrain the value */
  between(low: number, high: number): number;
  /** Chain into abs operation */
  abs(): number;
  /** Chain into map operation */
  map(): INumMapChain;
}

/**
 * Number utilities namespace with both direct and fluent APIs.
 */
export interface INumNamespace {
  // --- Direct functions (Arduino-compatible) ---
  
  /**
   * Re-map a number from one range to another.
   * Maps to Arduino `map()` function.
   */
  (value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number;
  
  /** Constrain a number to be within a range. */
  constrain(value: number, low: number, high: number): number;
  
  /** Get the absolute value. */
  abs(value: number): number;
  
  /** Get the minimum of two values. */
  min(a: number, b: number): number;
  
  /** Get the maximum of two values. */
  max(a: number, b: number): number;
  
  // --- Fluent builders ---
  
  /** Start a fluent map chain. */
  map(value: number): INumMapChain;
  
  /** Start a fluent constrain chain. */
  constrain(value: number): INumConstrainChain;
  
  // --- Convenience helpers ---
  
  /** Clamp a value to a range (alias for constrain). */
  clamp(value: number, low: number, high: number): number;
  
  /** Check if a value is within a range. */
  inRange(value: number, low: number, high: number): boolean;
  
  /** Map a value to 0-100 percent (convenience). */
  toPercent(value: number, fromLow: number, fromHigh: number): number;
  
  /** Map a value to 0-255 byte (convenience). */
  toByte(value: number, fromLow: number, fromHigh: number): number;
}

/** Stub for type checking. The transpiler replaces these with Arduino built-ins. */
declare const Num: INumNamespace;

export { Num };