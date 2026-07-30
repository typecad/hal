// ---------------------------------------------------------------------------
// @typecad/board-rp2040 — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { RP2040 } from '@typecad/mcu-rp2040';

const ARDUINO_CORE_VERSION = '10819';

export const RP2040Board: BoardDefinition = {
  id: 'rp2040',
  name: 'RP2040 (Pico)',
  vendor: 'Raspberry Pi',
  description:
    'Generic Raspberry Pi Pico (RP2040). Dual-core ARM Cortex-M0+ @ 133 MHz. ' +
    '30 GPIO, 264 KB SRAM, 2 MB QSPI flash. No wireless. USB device mode.',

  mcu: RP2040,
  clockSpeed: 133_000_000,

  memory: {
    flash: 2 * 1024 * 1024,
  },

  pins: {
    ...RP2040.pins,
  },

  peripherals: {
    ...RP2040.peripherals,
    aliases: {
      UART0: 'Serial1',
      UART1: 'Serial2',
      I2C0:  'Wire',
      I2C1:  'Wire1',
      SPI0:  'SPI',
      SPI1:  'SPI1',
    },
  },

  build: {
    frameworks: {
      platformio: 'rp2040',
      arduino: 'rp2040:rp2040:rpipico',
    },
    defines: {
      F_CPU:         '133000000UL',
      ARDUINO:       ARDUINO_CORE_VERSION,
      ARDUINO_RPIPICO: '1',
    },
  },
};

export default RP2040Board;

export * from '@typecad/mcu-rp2040';

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
  GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7,
  GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15,
  GP16, GP17, GP18, GP19, GP20, GP21, GP22,
  GP26, GP27, GP28,
} from '@typecad/mcu-rp2040';

export const pins = {
  pwm: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
        GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
        GP20, GP21, GP22, GP26, GP27, GP28] as const,
  analog: [GP26, GP27, GP28] as const,
  interrupt: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
              GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
              GP20, GP21, GP22, GP26, GP27, GP28] as const,
  digital: [GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9,
            GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19,
            GP20, GP21, GP22, GP26, GP27, GP28] as const,
} as const;

export const PeripheralPins = {
  I2C0: { SDA: 'GP4', SCL: 'GP5' } as const,
  SPI0: { MOSI: 'GP19', MISO: 'GP16', SCK: 'GP18', CS: 'GP17' } as const,
  UART0: { TX: 'GP0', RX: 'GP1' } as const,
  UART1: { TX: 'remappable', RX: 'remappable' } as const,
} as const;

export * from './pins.js';
export * from './analog.js';
export { Board } from './board.js';
