// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Timing utilities
//
// These map 1-to-1 to the Arduino built-in timing functions.
// The transpiler replaces calls with the C++ equivalents.
// ---------------------------------------------------------------------------

/** Block execution for `ms` milliseconds.  Maps to Arduino `delay()`. */
export declare function delay(ms: number): void;

/** Returns milliseconds since board reset.  Maps to Arduino `millis()`. */
export declare function millis(): number;

/** Returns microseconds since board reset.  Maps to Arduino `micros()`. */
export declare function micros(): number;

/** Block execution for `us` microseconds.  Maps to `delayMicroseconds()`. */
export declare function delayMicroseconds(us: number): void;

// ---------------------------------------------------------------------------
// Math / mapping helpers
// ---------------------------------------------------------------------------

/** Re-map a number from one range to another.  Maps to Arduino `map()`. */
export declare function map(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number;

/** Constrain a number between a low and high value.  Maps to `constrain()`. */
export declare function constrain(value: number, low: number, high: number): number;
