// ---------------------------------------------------------------------------
// @typecad/board-esp32-devkit — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32WROOM32 } from '@typecad/mcu-esp32';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32DevKit: BoardDefinition = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  vendor: 'Espressif',
  description: 'ESP32 DevKit v1 (38-pin) — ESP32-WROOM-32',

  mcu: ESP32WROOM32,
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32WROOM32.pins,
    led: 'GPIO2',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32WROOM32.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      UART2: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      arduino: 'esp32:esp32:esp32',
    },
    defines: {
      F_CPU:            '240000000UL',
      ARDUINO:          ARDUINO_CORE_VERSION,
      ARDUINO_ESP32_DEV: '1',
    },
  },
};

export default ESP32DevKit;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-esp32';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API overrides (using silicon pins from MCU)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19,
  GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33,
  GPIO34, GPIO35, GPIO36, GPIO39,
} from '@typecad/mcu-esp32';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs on ESP32). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33] as const,
  /** Analog input pins. */
  analog: [GPIO36, GPIO39, GPIO34, GPIO35, GPIO32, GPIO33] as const,
  /** All GPIOs support interrupts on ESP32. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33, GPIO34, GPIO35, GPIO36, GPIO39] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO21, GPIO22, GPIO23, GPIO25, GPIO26, GPIO27, GPIO32, GPIO33, GPIO34, GPIO35, GPIO36, GPIO39] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32 DevKit.
 */
export const PeripheralPins = {
  /** I2C bus 0 — requires GPIO21 (SDA) and GPIO22 (SCL). */
  I2C0: { SDA: 'GPIO21', SCL: 'GPIO22' } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / HSPI — GPIO13 (MOSI), GPIO12 (MISO), GPIO14 (SCK). GPIO15 is default CS. */
  SPI0: { MOSI: 'GPIO13', MISO: 'GPIO12', SCK: 'GPIO14', CS: 'GPIO15' } as const,
  /** SPI bus 1 / VSPI — GPIO23 (MOSI), GPIO19 (MISO), GPIO18 (SCK). GPIO5 is default CS. */
  SPI1: { MOSI: 'GPIO23', MISO: 'GPIO19', SCK: 'GPIO18', CS: 'GPIO5' } as const,
  /** UART 0 — GPIO1 (TX) and GPIO3 (RX). USB serial. */
  UART0: { TX: 'GPIO1', RX: 'GPIO3' } as const,
  /** UART 2 — GPIO17 (TX) and GPIO16 (RX). */
  UART2: { TX: 'GPIO17', RX: 'GPIO16' } as const,
} as const;

// Board-level typed pins (including Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';