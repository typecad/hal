// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite configuration: ESP32 DevKitC
//
// Alternate target, selected with:
//   npm run test:hw:esp32 --workspace @typecad/hal
//   (or: npx cuttlefish-test --config esp32-devkit.config.ts)
//
// Runs the board-agnostic groups (tests/*.test.ts — bus singletons, LED, A0,
// numeric ambient calls) plus the D-named gpio/spi groups under
// tests/boards/esp32-devkit/. Flashing goes through esptool (the board's
// default runner); test output comes back over the USB-serial bridge. Adjust
// `test.port` to your adapter.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/02-timing.test.ts',

  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32_devkitc/esp32/procpu',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-esp32',
  },

  toolchain: {
    type: 'west',
  },

  console: {
    baudRate: 115200,
  },

  // CONFIG_ESP32_USE_UNSUPPORTED_REVISION is required for the ESP32 DevKitC
  // rev in this workspace — mirrors packages/framework-zephyr/cuttlefish.config.ts.
  zephyr: {
    kconfig: { CONFIG_ESP32_USE_UNSUPPORTED_REVISION: 'y' },
  },

  test: {
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/*.test.ts',
      'tests/boards/esp32-devkit/*.test.ts',
    ],
  },
};

export default config;
