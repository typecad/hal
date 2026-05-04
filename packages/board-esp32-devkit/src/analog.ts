// ---------------------------------------------------------------------------
// @typehal/board-esp32-devkit — Analog helpers
//
// Typed wrappers around the ESP32 ADC subsystem.
// ---------------------------------------------------------------------------

/**
 * ADC reference voltage source.
 *
 * On the ESP32 (3.3 V logic):
 * - `DEFAULT`  = 3.3 V (VDD3.3)
 * - `INTERNAL` = 1.1 V internal reference (ADC1 only)
 *
 * NOTE: ADC2 cannot be used when WiFi is active.
 */
export declare const DEFAULT: number;
export declare const INTERNAL: number;
