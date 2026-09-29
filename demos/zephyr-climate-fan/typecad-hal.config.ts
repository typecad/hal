// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Climate fan bench (WeAct Black Pill V2.0)
//
// SHT30 on I2C0 samples temperature; a PID loop drives a 25 kHz PWM fan on
// PB6 (TIM4_CH1); the PA1 trim pot biases the setpoint; the KEY button
// cycles operating modes; mode + setpoint persist in a settings Store.
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
