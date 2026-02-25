// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Analog helpers
//
// The ESP32 uses LEDC for PWM-style analog output (dacWrite for true DAC)
// and attenuation settings instead of the AVR reference-voltage model.
// ---------------------------------------------------------------------------

/**
 * ADC input attenuation.
 *
 * Controls the full-scale voltage range for analogRead().
 * The ESP32 ADC reads relative to 3.3 V; attenuation extends the input range.
 *
 * | Value    | Input range   | Use case                   |
 * |----------|---------------|----------------------------|
 * | `DB_0`   | 0 – 1.1 V     | Precision low-voltage ADC  |
 * | `DB_2_5` | 0 – 1.5 V     |                            |
 * | `DB_6`   | 0 – 2.2 V     |                            |
 * | `DB_11`  | 0 – 3.3 V     | Default — full 3.3 V range |
 */
export enum AnalogAttenuation {
  DB_0   = 0,
  DB_2_5 = 1,
  DB_6   = 2,
  DB_11  = 3,
}

/**
 * Set the ADC input attenuation for all analogRead() calls.
 * Maps to `analogSetAttenuation(atten_t)` in the ESP32 Arduino framework.
 */
export declare function analogSetAttenuation(attenuation: AnalogAttenuation): void;

/**
 * Write an 8-bit value (0–255) to a DAC output pin.
 * Only GPIO 25 (DAC1) and GPIO 26 (DAC2) support true analog output.
 * Maps to `dacWrite(pin, value)`.
 */
export declare function dacWrite(pin: number, value: number): void;
