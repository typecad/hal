// ---------------------------------------------------------------------------
// @typecad/board-esp32c6 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { ESP32C6 } from '@typecad/mcu-esp32c6';

const ARDUINO_CORE_VERSION = '10819';

export const ESP32C6Board: BoardDefinition = {
  id: 'esp32c6',
  name: 'ESP32-C6',
  vendor: 'Espressif',
  description:
    'Generic ESP32-C6 devboard (vendor-agnostic). Single-core RISC-V ' +
    '(RV32IMAC) @ 160 MHz with Wi-Fi 6 (802.11ax) + BLE 5.3 and native USB ' +
    'Serial/JTAG + USB-OTG. 30 GPIO; no PSRAM support.',

  mcu: ESP32C6,
  clockSpeed: 160_000_000,

  memory: {
    flash: 4 * 1024 * 1024,
  },

  pins: {
    ...ESP32C6.pins,
  },

  peripherals: {
    ...ESP32C6.peripherals,
    aliases: {
      UART0: 'Serial',
      UART1: 'Serial1',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  build: {
    frameworks: {
      platformio: 'esp32c6',
      arduino: 'esp32:esp32:esp32c6',
    },
    defines: {
      F_CPU:             '160000000UL',
      ARDUINO:           ARDUINO_CORE_VERSION,
      ARDUINO_ESP32C6_DEV: '1',
    },
  },
};

export default ESP32C6Board;

export * from '@typecad/mcu-esp32c6';

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

import {
  GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7,
  GPIO8, GPIO9, GPIO10, GPIO11, GPIO12, GPIO13, GPIO14,
  GPIO15, GPIO16, GPIO17, GPIO18, GPIO19, GPIO20, GPIO21,
  GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27,
} from '@typecad/mcu-esp32c6';

export const pins = {
  pwm: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
        GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
        GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  analog: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6] as const,
  interrupt: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
              GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
              GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
  digital: [GPIO0, GPIO1, GPIO2, GPIO3, GPIO4, GPIO5, GPIO6, GPIO7, GPIO8, GPIO9,
            GPIO10, GPIO11, GPIO12, GPIO13, GPIO14, GPIO15, GPIO16, GPIO17, GPIO18,
            GPIO19, GPIO20, GPIO21, GPIO22, GPIO23, GPIO24, GPIO25, GPIO26, GPIO27] as const,
} as const;

export const PeripheralPins = {
  I2C0: { SDA: 'GPIO23', SCL: 'GPIO22' } as const,
  SPI0: { MOSI: 'GPIO19', MISO: 'GPIO20', SCK: 'GPIO21', CS: 'GPIO18' } as const,
  UART0: { TX: 'GPIO16', RX: 'GPIO17' } as const,
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

export * from './pins.js';
export * from './analog.js';
export { Board } from './board.js';
