// ---------------------------------------------------------------------------
// typecad-hal.config.ts — TypeScript pattern gallery (esp32s3_devkitc)
//
// A language-pattern gallery: every section of src/main.ts exercises one
// family of common idiomatic TypeScript (variables, functions, objects,
// arrays, classes, control flow) and prints its computed results over the
// board's uart0 console via the one-line `report` seam in report.ts.
//
// Pipeline: typecad-hal build → out/src/*.cpp → west build → west flash.
// Flash and console both ride the on-board CH343 USB-UART bridge:
//   npx typecad-hal build --compile --upload --monitor --port COM9
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',
  framework: '@typecad/framework-zephyr',
  board: 'esp32s3_devkitc/esp32s3/procpu',
  output: {
    outDir: './out',
  },
};

export default config;
