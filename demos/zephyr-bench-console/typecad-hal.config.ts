// ---------------------------------------------------------------------------
// typecad-hal.config.ts — bench console (ESP32 DevKitC)
//
// Pipeline: typecad-hal build → out/src/main.cpp + overlay + prj.conf →
// west build → west flash. Console I/O rides the board's uart0 default.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'esp32_devkitc/esp32/procpu',
  framework: '@typecad/framework-zephyr',

  output: { outDir: './out' },
};

export default config;
