// ---------------------------------------------------------------------------
// typecad-hal.config.ts — matrix station (ESP32-S3 DevKitC)
//
// The three wired-input P0 features in one loop: a 2x2 GPIO key matrix
// drives a servo position and an LED-strip position marker, with status on
// the console UART. No matrix keypad needed to try it — bridge a row pin
// and a column pin with a jumper to "press" that key.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out',
  },

  toolchain: {
    type: 'west',
  },

};

export default config;
