import type { TypecadConfig } from '@typecad/cuttlefish/api';

// Hardware-test config for the Zephyr framework. typecad-hal test transpiles
// each tests/*.test.ts via this config, builds it with west, flashes it to the
// ESP32 DevKitC, and reads the test results over the console.

const config: TypecadConfig = {
  entry: './tests/01-basics.test.ts',

  // Target architecture / silicon / board
  target: 'esp32',
  board: 'esp32_devkitc/esp32/procpu',

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
