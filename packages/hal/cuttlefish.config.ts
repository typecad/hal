// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite configuration
//
// Targets the ESP32 DevKitC via the Zephyr RTOS (west). Each tests/*.test.ts
// file exercises one HAL subsystem and is transpiled + flashed via
// `cuttlefish-test`. Run the whole suite or a single group:
//
//   npm run test:hw --workspace @typecad/hal                       # all groups
//   npm run test:hw:preferences --workspace @typecad/hal           # just prefs
//
// The Preferences group (14-preferences.test.ts) exercises the ZMS-backed
// settings lowering in @typecad/framework-zephyr: begin/typed put/get/end
// round-trips against real on-chip flash (the storage_partition at
// partition@3b0000 on the ESP32 devkitc). The other groups (gpio, timing, …)
// drive the Zephyr devicetree-spec lowering for their respective peripherals.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/01-gpio.test.ts',

  // Target architecture / silicon / board
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',

  // Framework package — Zephyr RTOS code generation
  framework: '@typecad/framework-zephyr',
  // Framework data — the ESP32 procu build target (the WiFi + flash core).
  frameworkData: {
    buildTarget: 'esp32_devkitc/esp32/procpu',
  },

  output: {
    outDir: './out',
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
    // Serial port for the hardware test board. Override locally with the
    // CUTTLEFISH_PORT env var (e.g. `CUTTLEFISH_PORT=/dev/ttyUSB0 npm run test:hw`).
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
