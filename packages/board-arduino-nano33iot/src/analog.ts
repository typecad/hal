// ---------------------------------------------------------------------------
// @typecode/board-arduino-nano33iot — Analog helpers
//
// The Arduino NANO 33 IoT uses the SAMD21 ADC reference system.
// Five reference sources are available; the default uses VCC (3.3 V).
//
// The SAMD21 also exposes a single DAC output on A0, enabled via
// `analogWrite(A0, value)` after setting the ADC resolution to 10 or 12 bits.
// ---------------------------------------------------------------------------

/**
 * ADC (and DAC) reference voltage source for the SAMD21.
 *
 * - `DEFAULT`      — VCC (3.3 V on the NANO 33 IoT)
 * - `INTERNAL`     — Internal 2.23 V bandgap reference
 * - `INTERNAL1V0`  — Internal 1.0 V reference
 * - `INTERNAL1V65` — Internal 1.65 V reference
 * - `INTERNAL2V23` — Internal 2.23 V reference
 * - `EXTERNAL`     — Voltage applied to the AREF pin
 */
export enum AnalogReference {
  DEFAULT      = 0,
  INTERNAL     = 2,
  INTERNAL1V0  = 4,
  INTERNAL1V65 = 5,
  INTERNAL2V23 = 6,
  EXTERNAL     = 1,
}

/**
 * Set the ADC reference voltage source.
 * Maps to Arduino `analogReference()`.
 */
export declare function analogReference(ref: AnalogReference): void;

/**
 * Set the resolution of `analogRead()` and `analogWrite()` in bits.
 * The SAMD21 supports up to 12-bit reads and 10-bit writes.
 * Maps to Arduino `analogReadResolution()` / `analogWriteResolution()`.
 */
export declare function analogReadResolution(bits: number): void;
export declare function analogWriteResolution(bits: number): void;
