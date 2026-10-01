// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Bit-bang DHT22 station (WeAct Black Pill V2.0)
//
// A three-file program: the driver module (dht.ts) bit-bangs the one-wire
// protocol with microsecond timing; metrics.ts holds the conversion
// namespace; main.ts runs the cooperative task loop. The sensor sits on PA8
// with its power rail gated through a config register write at boot. With no
// sensor attached the driver times out and reports NO SENSOR — the graceful
// path a real driver takes.
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
