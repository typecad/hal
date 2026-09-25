// ---------------------------------------------------------------------------
// typecad-hal.config.ts — timed-wake deep-sleep demo (ESP32-S3 DevKitC)
//
// The battery pattern: wake, report, sleep. Each cycle the board boots,
// prints its wake count and a per-wake wall-clock stamp, stays awake
// ~2 s, then Power.offFor(5000) enters soft-off with the RTC timer
// armed. The serial capture shows one burst every ~5 seconds,
// and microamp draw between them.
//
// Wake count persistence: deep sleep does not retain RAM, but the ESP32's
// RTC slow-clock memory does — Store (settings/NVS) survives, so the
// counter increments across sleeps. That's the honest persistence story:
// File/Store ride the flash settings area, never RAM.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out',
  },

  toolchain: {
    type: 'west',
  },
};

export default config;
