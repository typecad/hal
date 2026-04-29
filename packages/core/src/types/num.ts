// ---------------------------------------------------------------------------
// @typehal/core — Fluent number utilities
//
// Direct functions and fluent chainable API.
// ---------------------------------------------------------------------------

/**
 * Number utilities namespace with both direct and fluent APIs.
 */
export interface INumNamespace {
  // --- Direct functions ---

  /** Re-map a number from one range to another. */
  (value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number;

  /** Clamp a number to be within a range. */
  clamp(value: number, low: number, high: number): number;

  /** Get the absolute value. */
  abs(value: number): number;

  /** Get the minimum of two values. */
  min(a: number, b: number): number;

  /** Get the maximum of two values. */
  max(a: number, b: number): number;

  // --- Convenience helpers ---

  /** Check if a value is within a range. */
  inRange(value: number, low: number, high: number): boolean;

  /** Map a value to 0-100 percent. */
  toPercent(value: number, fromLow: number, fromHigh: number): number;

  /** Map a value to 0-255 byte. */
  toByte(value: number, fromLow: number, fromHigh: number): number;
}

/** Stub for type checking. The transpiler replaces these with built-ins. */
declare const Num: INumNamespace;

export { Num };
