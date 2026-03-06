// ---------------------------------------------------------------------------
// Analog helpers — Reference voltage model
//
// Typed wrappers around the Arduino ADC subsystem.
// ---------------------------------------------------------------------------

/**
 * ADC reference voltage source.
 *
 * On most AVR boards:
 * - `DEFAULT`  = AVcc (5 V or 3.3 V)
 * - `INTERNAL` = Internal reference (varies by board)
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
