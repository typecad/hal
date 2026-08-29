// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Time API showcase (Seeed XIAO nRF52840)
//
// Exercises the TS-flavored timing surface: Time.sleep/now/nowUs/busyWaitUs,
// the setInterval polyfill, and a kernel Thread driving the LED off-main.
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  framework: '@typecad/framework-zephyr',

  board: 'xiao_ble/nrf52840',

  output: {
    outDir: './out',
  },
  console: { port: 'COM5' },

};

export default config;
