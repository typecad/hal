// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: ESP32-C3 DevKitM
//
// Best-effort config for a board with no hardware in this workspace: build
// target and MCU data follow the framework-zephyr chip descriptors. Runs the
// shared suite (tests/common + tests/board); pin choices live in the board
// package's test-pins.json. Adjust `test.port` before flashing.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'esp32c3',
  mcu: '@typecad/mcu-esp32c3',
  board: '@typecad/board-esp32c3',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32c3_devkitm/esp32c3',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-esp32c3',
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
