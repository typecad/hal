import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-avr',
  frameworkData: { buildTarget: 'arduino:avr:uno' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out-avr' },
  toolchain: { type: 'arduino-cli' },
  console: { baudRate: 115200 },
};

export default config;
