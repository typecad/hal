import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Hardware-test config for the Zephyr framework. cuttlefish-test transpiles
// each tests/*.test.ts via this config, builds it with west, flashes it to the
// ESP32 DevKitC, and reads the test results over the console.

const config: CuttlefishConfig = {
  entry: './tests/01-basics.test.ts',

  // Target architecture / silicon / board
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',

  // Framework package — Zephyr RTOS code generation
  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32_devkitc/esp32/procpu',
  },

  output: {
    outDir: './out',
  },

  toolchain: {
    type: 'west',
  },

  console: { baudRate: 115200 },

  zephyr: {
    kconfig: { 'CONFIG_ESP32_USE_UNSUPPORTED_REVISION': 'y' },
  },

  test: {
    // Update port to your board's serial device before running test:hw.
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
