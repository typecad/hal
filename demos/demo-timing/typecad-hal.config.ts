// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Time API showcase (Seeed XIAO nRF52840)
//
// Exercises the TS-flavored timing surface: Time.sleep/now/nowUs/busyWaitUs,
// kernel Threads driving the LED blink and the beat logger off-main.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',
  framework: '@typecad/framework-zephyr',

  board: 'xiao_ble/nrf52840',

  // Runtime tracing: emits the heartbeat sampler ([TR: lines) so
  // `typecad-hal trace capture --port <p> --duration 10` can record this
  // demo's two threads + idle CPU load and stack high-water marks, then
  // `typecad-hal trace report` summarizes the capture.
  zephyr: {
    trace: { enabled: true, intervalMs: 1000 },
  },

  output: {
    outDir: './out',
  },

};

export default config;
