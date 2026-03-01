// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Timing utilities
//
// Native AVR timing functions using direct register access and AVR libc.
// These provide precise timing without Arduino framework overhead.
// ---------------------------------------------------------------------------

/** Block execution for `ms` milliseconds. Uses AVR libc _delay_ms(). */
export declare function delay(ms: number): Promise<void>;

/** Returns milliseconds since board reset. Requires Timer0 initialization. */
export declare function millis(): number;

/** Returns microseconds since board reset. Requires Timer0 initialization. */
export declare function micros(): number;

/** Block execution for `us` microseconds. Uses AVR libc _delay_us(). */
export declare function delayMicroseconds(us: number): Promise<void>;

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

/** Re-map a number from one range to another. */
export declare function map(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number;

/** Constrain a number between a low and high value. */
export declare function constrain(value: number, low: number, high: number): number;
