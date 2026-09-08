import type { TypecadConfig } from '@typecad/cuttlefish/api';

// Diagnostic BLE peripheral — no expect harness. Flashed standalone, then a
// raw serial reader watches the console while the noble central connects.
const config: TypecadConfig = {

  board: 'esp32s3_devkitc/esp32s3/procpu',
  framework: '@typecad/framework-zephyr',

  console: { baudRate: 115200 },
  entry: './src/main.ts',
};

export default config;
