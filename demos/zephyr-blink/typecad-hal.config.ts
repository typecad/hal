// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Zephyr blink demo (Seeed XIAO nRF52840)
//
// Blink the onboard user LED (active-low) using @typecad/framework-zephyr.
// GPIO is lowered through a devicetree spec (gpio_pin_*_dt), so the
// GPIO_ACTIVE_LOW flag in xiao_ble.dts makes .high() = LED on.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
//
// Prerequisites (not installed in this environment — see README):
//   - Zephyr SDK + west on PATH
//   - ZEPHYR_BASE env var set
//   - XIAO nRF52840 connected via USB (J-Link / nrfjprog runner)
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',
  framework: '@typecad/framework-zephyr',
  board: 'xiao_ble/nrf52840',
  output: {
    outDir: './out',
  },
  // Upload port for `npm run upload`. Precedence: --port flag >
  // TYPECAD_HAL_PORT env var > this config — Linux/macOS users can set
  // TYPECAD_HAL_PORT=/dev/ttyACM0 instead of editing the file.
};

export default config;
