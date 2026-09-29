// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Sentence router (WeAct Black Pill V2.0)
//
// A UART telemetry link in the NMEA shape: `$TT,KEY,ARGS*CS` sentences arrive
// on UART0 RX, get checksum-verified, split into fields, routed through a
// polymorphic Field hierarchy, and aggregated into a per-talkerer stats table.
// The pot (PA1) injects a synthetic drift sentence; the KEY button forces a
// report; a heartbeat thread blinks the LED.
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
