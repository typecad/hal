// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: ESP32 DevKitC
//
// Runs the shared suite (tests/common + tests/board) through the Zephyr RTOS
// on the ESP32. Flashing goes through esptool (the board's default runner);
// test output comes back over the USB-serial bridge. Adjust `test.port` to
// your adapter.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32_devkitc/esp32/procpu',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-esp32-devkit',
  },

  toolchain: {
    type: 'west',
  },

  console: {
    baudRate: 115200,
  },

  // CONFIG_ESP32_USE_UNSUPPORTED_REVISION is required for the ESP32 DevKitC
  // rev in this workspace.
  zephyr: {
    kconfig: { CONFIG_ESP32_USE_UNSUPPORTED_REVISION: 'y' },
  },

  test: {
    // Upload + console on the CP2102 USB-serial bridge (FT232 clones report
    // 0403:6001). Resolved by USB identity; the explicit port is the fallback.
    usb: { vid: '10C4', pid: 'EA60' },
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
