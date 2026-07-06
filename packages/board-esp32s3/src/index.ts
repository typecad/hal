// ---------------------------------------------------------------------------
// @typecad/board-esp32s3 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32S3 } from '@typecad/mcu-esp32s3';

/** Arduino core API version for this board's build defines. */
const ARDUINO_CORE_VERSION = '10819';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const ESP32S3Board: BoardDefinition = {
  id: 'esp32s3',
  name: 'ESP32-S3',
  vendor: 'Espressif',
  description:
    'Generic ESP32-S3 (vendor-agnostic). Dual-core Xtensa LX7 @ 240 MHz ' +
    'with Wi-Fi 4 + BLE 5 and native USB-OTG. Flash/PSRAM are module-dependent; ' +
    'override via FQBN menu options, e.g. ' +
    'esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi',

  mcu: ESP32S3,
  clockSpeed: 240_000_000, // 240 MHz

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 8 * 1024 * 1024,        // 8 MB module flash (N8R2-class default)
    externalRam: 2 * 1024 * 1024,  // 2 MB octal PSRAM
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...ESP32S3.pins,
    led: 'GPIO48',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...ESP32S3.peripherals,
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
      platformio: 'esp32s3',
      arduino: 'esp32:esp32:esp32s3',
    },
    defines: {
      F_CPU:              '240000000UL',
      ARDUINO:            ARDUINO_CORE_VERSION,
      ARDUINO_ESP32S3_DEV: '1',
    },
  },
};

export default ESP32S3Board;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level (local MCU module)
export * from '@typecad/mcu-esp32s3';

// Generic HAL re-exports from @typecad/hal
export {
  HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP,
  delay, millis, micros, delayMicroseconds,
  map, constrain,
  abs, min, max, Num,
  pulseIn, pulseInLong, Pulse,
  shiftIn, shiftOut, Shift,
  randomSeed, random, Random,
  noInterrupts, interrupts, attachInterrupt, detachInterrupt,
  ADC, AsyncClass, Async
} from '@typecad/hal';

// Board-level pin Discovery API (uses local silicon pins)
import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43, GPIO44,
  GPIO45, GPIO46, GPIO47, GPIO48,
} from '@typecad/mcu-esp32s3';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (all output-capable GPIOs that are not flash/USB/strap). */
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
        GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** Analog input pins (ADC1 — usable while Wi-Fi active). */
  analog: [GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9, GPIO10] as const,
  /** All GPIOs support interrupts on ESP32-S3. */
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
              GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
  /** All digital I/O pins. */
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO38, GPIO39, GPIO40, GPIO41, GPIO42, GPIO43,
            GPIO44, GPIO45, GPIO46, GPIO47, GPIO48] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the ESP32-S3.
 */
export const PeripheralPins = {
  /** I2C bus 0 — default GPIO8 (SDA) / GPIO9 (SCL); remappable via GPIO matrix. */
  I2C0: { SDA: 'GPIO8',  SCL: 'GPIO9'  } as const,
  /** I2C bus 1 — no fixed pins (remappable). */
  I2C1: { SDA: 'remappable', SCL: 'remappable' } as const,
  /** SPI bus 0 / FSPI — GPIO12 (MOSI), GPIO13 (MISO), GPIO11 (SCK). GPIO10 is default CS. */
  SPI0: { MOSI: 'GPIO12', MISO: 'GPIO13', SCK: 'GPIO11', CS: 'GPIO10' } as const,
  /** SPI bus 1 / GPSI — no fixed pins (remappable). */
  SPI1: { MOSI: 'remappable', MISO: 'remappable', SCK: 'remappable' } as const,
  /** UART 0 — GPIO43 (TX) / GPIO44 (RX). USB-CDC serial available too. */
  UART0: { TX: 'GPIO43', RX: 'GPIO44' } as const,
  /** UART 1 — no fixed pins (remappable). */
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

// Board-level typed pins (Arduino-style aliases D0, A0, etc.)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
