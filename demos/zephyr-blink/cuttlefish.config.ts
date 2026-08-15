// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Zephyr blink demo (Seeed XIAO nRF52840)
//
// Blink the onboard user LED (active-low) using @typecad/framework-zephyr.
// GPIO is lowered through a devicetree spec (gpio_pin_*_dt), so the
// GPIO_ACTIVE_LOW flag in xiao_ble.dts makes .high() = LED on.
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
//
// Prerequisites (not installed in this environment — see README):
//   - Zephyr SDK + west on PATH
//   - ZEPHYR_BASE env var set
//   - XIAO nRF52840 connected via USB (J-Link / nrfjprog runner)
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  framework: '@typecad/framework-zephyr',
  target: 'nrf52',
  mcu: '@typecad/mcu-nrf52840',
  board: '@typecad/board-xiao-nrf52840',
  frameworkData: { buildTarget: 'xiao_ble' },
  output: {
    outDir: './out',
  },
  // Upload port for `npm run upload`. Precedence: --port flag >
  // CUTTLEFISH_PORT env var > this config — Linux/macOS users can set
  // CUTTLEFISH_PORT=/dev/ttyACM0 instead of editing the file.
  console: { port: 'COM13' },
  toolchain: { type: 'west' },
};

export default config;
