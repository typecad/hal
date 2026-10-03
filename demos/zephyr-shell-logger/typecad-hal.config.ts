// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Sentence shell + session logger (Black Pill V2.0)
//
// A $CMD,field,...*CS grammar shell over the USB CDC console, with settings
// persisted to a littlefs file, an async boot sequence, and an LED heartbeat.
//
// Pipeline: typecad-hal build -> out/src -> west build -> west flash.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'blackpill_f401cc/stm32f401xc',
  framework: '@typecad/framework-zephyr',

  output: { outDir: './out' },

  zephyr: {
    probe: 'stlink',
  },
};

export default config;
