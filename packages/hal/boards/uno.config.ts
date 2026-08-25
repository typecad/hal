// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: Arduino Uno (ATmega328P)
//
// Runs the shared suite (tests/common + tests/board), compiled with
// arduino-cli and uploaded over the board's serial bootloader. Adjust
// `test.port` to your adapter. Note tests/common/08-uart.test.ts self-skips
// on AVR (UART0 is the protocol channel the runner itself reads — there is
// no second UART on an ATmega328P).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',

  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },

  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out-uno',
  },

  toolchain: {
    type: 'arduino-cli',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    // Upload + console on the 16U2 USB-serial bridge (official Uno; CH340
    // clones report 1A86:7523 — set that here or pass --port). Resolved by
    // USB identity; the explicit port below is the fallback.
    usb: { vid: '2341', pid: '0043' },
    port: 'COM8',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
