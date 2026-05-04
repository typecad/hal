// ---------------------------------------------------------------------------
// @typehal/board-arduino-uno — Analog helpers
//
// Typed wrappers around the Arduino ADC subsystem.
// ---------------------------------------------------------------------------

/**
 * ADC reference voltage source.
 *
 * On the Arduino Uno (ATmega328P):
 * - `DEFAULT`  = AVcc (5 V)
 * - `INTERNAL` = Internal 1.1 V reference
 * - `EXTERNAL` = Voltage on the AREF pin
 */
export declare const DEFAULT: number;
export declare const INTERNAL: number;
export declare const EXTERNAL: number;
