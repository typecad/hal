// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Async Environment Station (WeAct Black Pill V2.0)
//
// Three cooperative async tasks share the one superloop pump the engine
// generates: a sampler (EMA + history vector), an alarmer (hysteresis with a
// latched peak), and a reporter. The boot banner reads the chip revision and
// device ID straight out of the DBGMCU_IDCODE register through a @register
// bitfield class. The KEY button (short press) forces an immediate report.
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
