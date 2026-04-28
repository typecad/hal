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
export enum AnalogReference {
  DEFAULT  = 1,
  INTERNAL = 3,
  EXTERNAL = 0,
}

/**
 * Set the ADC reference voltage.
 * Maps to Arduino `analogReference()`.
 */
export declare function analogReference(ref: AnalogReference): void;
