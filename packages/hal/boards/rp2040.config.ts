// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: Raspberry Pi Pico (RP2040)
//
// Best-effort config for a board with no hardware in this workspace: build
// target and MCU data follow the framework-zephyr chip descriptors. Runs the
// shared suite (tests/common + tests/board); pin choices live in the board
// package's test-pins.json. Adjust `test.port` before flashing.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'rp2040',
  mcu: '@typecad/mcu-rp2040',
  board: '@typecad/board-rp2040',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'rpi_pico',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-rp2040',
  },

  toolchain: {
    type: 'west',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    // Console found by USB identity (best-effort for a board with no
    // hardware in this workspace). Zephyr CDC boards carry their per-board
    // PID; ESP32 variants identify by the USB-Serial/JTAG console.
    usb: { vid: '2FE3', pid: '0004' },
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
