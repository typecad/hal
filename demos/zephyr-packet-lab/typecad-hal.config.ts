// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Packet Lab (WeAct Black Pill V2.0)
//
// Three synthetic sensors produce readings; a framer serializes each reading
// into an escaped byte packet; a state-machine parser walks the merged byte
// stream back out; per-channel tallies land in a Map; the console prints a
// sorted leaderboard and a hex dump. A tiny recursive evaluator answers
// "config expressions" like "2*3+4" so the lab's gains are data, not code.
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
