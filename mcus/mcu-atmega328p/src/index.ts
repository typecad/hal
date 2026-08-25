// ---------------------------------------------------------------------------
// @typecad/mcu-atmega328p — MCU definition package
//
// Provides datasheet-level pin definitions, hardware peripheral descriptions,
// and framework pin mappings for the ATmega328P microcontroller.
// Board packages (e.g. board-arduino-uno) import from here and add
// board-specific aliases and wiring.
// ---------------------------------------------------------------------------

// Re-export all pin definitions
export * from './pins.js';

// Re-export hardware peripheral descriptions
export * from './peripherals.js';

// Re-export MCU definition
export * from './mcu.js';

// Re-export Arduino pin mapping (used by transpiler and framework strategy)
export * from './arduino-map.js';

/**
 * Structured manifest consumed by the TypeCAD CLI for contract-based
 * board generation. Provides pin names and peripheral instance names
 * without requiring the CLI to text-scrape compiled output.
 */
export const TypeCADManifest = {
  /** All MCU port-level pin names (e.g. 'PB5', 'PC4'). */
  pinNames: [
    'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
    'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7',
    'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6'
  ] as const,

  /** All HAL peripheral instance names exported from this package. */
  peripheralNames: ['I2C0', 'SPI0', 'UART0'] as const,
} as const;



// Generic HAL re-exports — an MCU package is a superset of @typecad/hal
// (mirrors board packages), so code importing from '@typecad/board' resolves
// identically whether a board package is configured or bare silicon.
export * from '@typecad/hal';
