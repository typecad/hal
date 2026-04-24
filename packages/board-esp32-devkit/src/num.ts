// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Number utilities
//
// Fluent chainable API for map, constrain, min, max, abs.
// The transpiler replaces calls with Arduino C++ equivalents.
// ---------------------------------------------------------------------------

import type { INumNamespace } from '@typecode/core';

// ---------------------------------------------------------------------------
// Direct Functions (Arduino-compatible)
// ---------------------------------------------------------------------------

/** Re-map a number from one range to another. Maps to Arduino `map()`. */
export declare function map(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number;

/** Constrain a number to be within a range. Maps to Arduino `constrain()`. */
export declare function constrain(value: number, low: number, high: number): number;

/** Get the absolute value. Maps to Arduino `abs()`. */
export declare function abs(value: number): number;

/** Get the minimum of two values. Maps to Arduino `min()`. */
export declare function min(a: number, b: number): number;

/** Get the maximum of two values. Maps to Arduino `max()`. */
export declare function max(a: number, b: number): number;

// ---------------------------------------------------------------------------
// Convenience Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to a range (alias for constrain). */
export declare function clamp(value: number, low: number, high: number): number;

/** Check if a value is within a range. */
export declare function inRange(value: number, low: number, high: number): boolean;

/** Map a value to 0-100 percent (convenience). */
export declare function toPercent(value: number, fromLow: number, fromHigh: number): number;

/** Map a value to 0-255 byte (convenience). */
export declare function toByte(value: number, fromLow: number, fromHigh: number): number;

// ---------------------------------------------------------------------------
// Fluent Chain Builders
// ---------------------------------------------------------------------------

/** Stub for fluent map chain. Transpiler handles actual code generation. */
export declare const Num: INumNamespace;
