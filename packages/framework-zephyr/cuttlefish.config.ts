import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Hardware-test config for the Zephyr framework. cuttlefish-test transpiles
// each tests/*.test.ts via this config, builds it with west, flashes it to the
// XIAO nRF52840, and reads the test results over the console.

const config: CuttlefishConfig = {
  entry: './tests/01-basics.test.ts',

  // Target architecture / silicon / board
  target: 'nrf52',
  mcu: '@typecad/mcu-nrf52840',
  board: '@typecad/board-xiao-nrf52840',

  // Framework package — Zephyr RTOS code generation
  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'xiao_ble',
  },

  output: {
    outDir: './out',
  },

  toolchain: {
    type: 'west',
  },

  test: {
    // Update port to your XIAO's serial device before running test:hw.
    port: 'COM8',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
