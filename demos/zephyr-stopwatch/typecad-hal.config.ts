// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Stopwatch (WeAct Black Pill V2.0)
//
// The pot (PA1) simulates a temperature sensor; a small ring buffer averages
// the readings, a hysteresis band drives the LED, the KEY button cycles the
// mode, and a one-line report rides the console UART every few seconds.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
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
