// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: Raspberry Pi Pico 2 (RP2350)
//
// Best-effort config for a board with no hardware in this workspace: build
// target and MCU data follow the framework-zephyr chip descriptors. Runs the
// shared suite (tests/common + tests/board); pin choices live in the board
// package's test-pins.json. Adjust `test.port` before flashing.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'rp2350',
  mcu: '@typecad/mcu-rp2350',
  board: '@typecad/board-rp2350',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'rpi_pico2/rp2350a/m33',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-rp2350',
  },

  toolchain: {
    type: 'west',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: '',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
