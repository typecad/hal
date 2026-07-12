import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ATmega328P } from '@typecad/mcu-atmega328p';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ArduinoUno: BoardDefinition = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  vendor: 'Arduino',
  description: 'Arduino Uno Rev3 — ATmega328P',

  mcu: ATmega328P,
  clockSpeed: 16_000_000, // 16 MHz

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ATmega328P.pins,
    all: ATmega328P.pins.all.map(p => {
      // Add board-specific metadata to PB5 (LED)
      if (p.name === 'PB5') {
        return {
          ...p,
          aliases: [...(p.aliases || []), 'LED'],
          onboardLed: true,
          alternateFunctions: [...(p.alternateFunctions || []), 'On-board LED'],
          warnings: [...(p.warnings || []), 'PB5 is also the on-board LED — using as GPIO conflicts with SPI0 SCK']
        };
      }
      return p;
    }),
    led: 'PB5',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ATmega328P.peripherals,
    aliases: {
      UART0: 'Serial',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      platformio: 'uno',
      arduino: 'arduino:avr:uno',
    },
    defines: {
      F_CPU:           '16000000UL',
      ARDUINO_AVR_UNO: '1',
    },
  },
};

export default ArduinoUno;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package (pure silicon)
export * from '@typecad/mcu-atmega328p';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (using silicon pins from MCU)
import {
  PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7,
  PB0, PB1, PB2, PB3, PB4, PB5,
  PC0, PC1, PC2, PC3, PC4, PC5,
} from '@typecad/mcu-atmega328p';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins: PD3, PD5, PD6, PB1, PB2, PB3 */
  pwm: [PD3, PD5, PD6, PB1, PB2, PB3] as const,
  /** Analog input pins: PC0, PC1, PC2, PC3, PC4, PC5 */
  analog: [PC0, PC1, PC2, PC3, PC4, PC5] as const,
  /** External interrupt-capable pins: PD0, PD1, PD2, PD3 */
  interrupt: [PD0, PD1, PD2, PD3] as const,
  /** All digital I/O pins */
  digital: [PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7, PB0, PB1, PB2, PB3, PB4, PB5, PC0, PC1, PC2, PC3, PC4, PC5] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the Arduino Uno.
 */
export const PeripheralPins = {
  /** I2C bus 0 — requires PC4 (SDA) and PC5 (SCL). */
  I2C0: { SDA: 'PC4', SCL: 'PC5' } as const,
  /** SPI bus 0 — requires PB3 (MOSI), PB4 (MISO), PB5 (SCK). PB2 is default CS. */
  SPI0: { MOSI: 'PB3', MISO: 'PB4', SCK: 'PB5', CS: 'PB2' } as const,
  /** UART/Serial 0 — requires PD1 (TX) and PD0 (RX). */
  UART0: { TX: 'PD1', RX: 'PD0' } as const,
  /** UART/Serial 1 — requires PD2 (TX) and PD3 (RX). */
  UART1: { TX: 'PD2', RX: 'PD3' } as const,
} as const;

// Board-level typed pins (including Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';