import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32s3' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out-esp32s3' },
  toolchain: { type: 'arduino-cli' },
  console: { baudRate: 115200 },
};

export default config;
