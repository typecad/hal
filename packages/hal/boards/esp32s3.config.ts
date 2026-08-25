// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: ESP32-S3 DevKitC
//
// Best-effort config for a board with no hardware in this workspace: build
// target and MCU data follow the framework-zephyr chip descriptors. Runs the
// shared suite (tests/common + tests/board); pin choices live in the board
// package's test-pins.json. Adjust `test.port` before flashing.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32s3_devkitc',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-esp32s3',
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
