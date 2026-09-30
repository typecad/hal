// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Utility Meter Logger (WeAct Black Pill V2.0)
//
// The meter pulse input (BUTTON pad) is counted from interrupt context; a
// superloop samples pulses/temperature/battery into a ring buffer; a
// background thread flushes the ring to a CSV file on the flash filesystem;
// lifetime totals persist in settings; a serial console answers status /
// dump / totals / clear / factory; the main loop feeds the watchdog.
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
