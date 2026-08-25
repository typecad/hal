// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: ESP32-C6 DevKitC
//
// Best-effort config for a board with no hardware in this workspace: build
// target and MCU data follow the framework-zephyr chip descriptors. Runs the
// shared suite (tests/common + tests/board); pin choices live in the board
// package's test-pins.json. Adjust `test.port` before flashing.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'esp32c6',
  mcu: '@typecad/mcu-esp32c6',
  board: '@typecad/board-esp32c6',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32c6_devkitc/esp32c6/hpcore',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-esp32c6',
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
    usb: { vid: '303A', pid: '4001' },
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
