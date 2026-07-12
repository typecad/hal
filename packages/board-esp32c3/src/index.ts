// ---------------------------------------------------------------------------
// @typecad/board-esp32c3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C3 } from '@typecad/mcu-esp32c3';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32C3Board: BoardDefinition = {
  id: 'esp32c3',
  name: 'ESP32-C3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C3 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMC) @ 160 MHz with Wi-Fi 4 + BLE 5 and native USB Serial/JTAG. ' +
    '22 GPIO; no PSRAM support.',

  mcu: ESP32C3,
  clockSpeed: 160_000_000, // 160 MHz

  // ----- Memory (module-level; silicon memory lives on the MCU) -----------
  // 4 MB module flash; no external RAM (the C3 silicon does not support it).
  memory: {
    flash: 4 * 1024 * 1024,
  },

  // ----- Pins (no onboard LED declared — generic board) -------------------
  pins: {
    ...ESP32C3.pins,
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32C3.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      platformio: 'esp32c3',
      arduino: 'esp32:esp32:esp32c3',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C3_DEV: '1',
    },
  },
};

export default ESP32C3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level
export * from '@typecad/mcu-esp32c3';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses silicon pins from MCU)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10,
  GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
  GPIO18, GPIO19, GPIO20, GPIO21,
} from '@typecad/mcu-esp32c3';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
        GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4] as const,
  /** All GPIOs support interrupts on ESP32-C3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
              GPIO18, GPIO19, GPIO20, GPIO21] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17,
            GPIO18, GPIO19, GPIO20, GPIO21] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-C3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** SPI bus 0 / GPSPI2 — GPIO6 (MOSI), GPIO5 (MISO), GPIO4 (SCK). GPIO7 is default CS. */
  SPI0: { MOSI: 'GPIO6', MISO: 'GPIO5', SCK: 'GPIO4', CS: 'GPIO7' } as const,
  /** UART 0 — GPIO21 (TX) / GPIO20 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO21', RX: 'GPIO20' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
