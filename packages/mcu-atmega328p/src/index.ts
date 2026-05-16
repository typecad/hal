// ---------------------------------------------------------------------------
// @typehal/mcu-atmega328p — MCU definition package
//
// Provides datasheet-level pin definitions, hardware peripheral descriptions,
// and framework pin mappings for the ATmega328P microcontroller.
// Board packages (e.g. board-arduino-uno) import from here and add
// board-specific aliases and wiring.
// ---------------------------------------------------------------------------

// Re-export all pin definitions
export * from './pins';

// Re-export hardware peripheral descriptions
export * from './peripherals';

// Re-export MCU definition
export * from './mcu';

// Re-export Arduino pin mapping (used by transpiler and framework strategy)
export * from './arduino-map';

