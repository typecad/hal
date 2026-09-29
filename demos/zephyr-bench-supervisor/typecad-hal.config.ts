// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Bench supervisor (WeAct Black Pill V2.0)
//
// A UART command console over the supervisor role: the pot (PA1) streams
// histogram samples, the KEY button dumps the event log, commands arrive on
// the console RX line, and a hardware watchdog arms the whole loop.
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
