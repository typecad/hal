import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-esp32',
  // frameworkData.buildTarget is the IDF target string ('esp32' | 'esp32s3' |
  // 'esp32c3' | 'esp32c6'). The cuttlefish CLI reads this to populate
  // ToolchainOptions.buildTarget, which our idf.py toolchain uses to pick the
  // chip + sdkconfig.defaults. (Also drives chip-descriptor routing.)
  frameworkData: { buildTarget: 'esp32' },
  output: { framework: 'esp32', optimize: 'size', outDir: './out-esp32' },
  toolchain: { type: 'idf' },
  console: { baudRate: 115200 },
};

export default config;
