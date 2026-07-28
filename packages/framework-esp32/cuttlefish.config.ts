import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/01-basics.test.ts',

  // Target architecture family; the specific chip variant is selected via
  // frameworkData.buildTarget below.
  target: 'esp32',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',

  // One framework package handles all ESP32 variants; the variant is data.
  framework: '@typecad/framework-esp32',
  frameworkData: {
    target: 'esp32s3',
    buildTarget: 'esp32s3',
  },

  output: {
    framework: 'esp32',
    optimize: 'size',
    outDir: './out',
  },

  toolchain: {
    type: 'idf',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: 'COM5',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
