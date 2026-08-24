// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite configuration: Arduino Uno
//
// Alternate target, selected with:
//   npm run test:hw:uno --workspace @typecad/hal
//   (or: npx cuttlefish-test --config uno.config.ts)
//
// Runs the board-agnostic groups (tests/*.test.ts) plus the D-named gpio/spi
// groups under tests/boards/uno/, compiled with arduino-cli and uploaded over
// the board's serial bootloader. Adjust `test.port` to your adapter. Note
// tests/08-uart.test.ts self-skips on AVR (UART0 is the protocol channel the
// runner itself reads — there is no second UART on an ATmega328P).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/02-timing.test.ts',

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
    port: 'COM8',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/*.test.ts',
      'tests/boards/uno/*.test.ts',
    ],
  },
};

export default config;
