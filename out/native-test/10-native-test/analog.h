#pragma once

// ---------------------------------------------------------------------------
// ADC reference voltage constants
// ---------------------------------------------------------------------------
/**
 * ADC reference voltage source selection.
 * These values correspond to the REFS1:0 bits in the ADMUX register.
 */
enum class AnalogReference {
  _DEFAULT = 0,
  _INTERNAL = 3,
  _EXTERNAL = 0
};

// ---------------------------------------------------------------------------
// ADC prescaler constants
// ---------------------------------------------------------------------------
/**
 * ADC prescaler values for controlling the ADC clock.
 * The ADC requires a clock between 50kHz and 200kHz for maximum resolution.
 * With a 16MHz system clock:
 * - Prescaler 128 → 125kHz ADC clock (default Arduino setting)
 * - Prescaler 64  → 250kHz ADC clock (faster but slightly lower resolution)
 */
enum class ADCPrescaler {
  DIV2 = 1,
  DIV4 = 2,
  DIV8 = 3,
  DIV16 = 4,
  DIV32 = 5,
  DIV64 = 6,
  DIV128 = 7
};
