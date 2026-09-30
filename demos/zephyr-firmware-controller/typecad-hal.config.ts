// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Fan Controller firmware (WeAct Black Pill V2.0)
//
// A plain superloop firmware: the pot simulates a temperature sensor, the
// logic filters it, runs a hysteresis controller with slew-limited PWM on a
// fan, latches alarms, persists its calibration in flash, answers a serial
// command interpreter, and feeds the watchdog. What a small shipped device
// actually looks like — no RTOS threads, just scheduled work.
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
