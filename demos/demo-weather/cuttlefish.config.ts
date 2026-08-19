import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32s3:PSRAM=opi',
  },
  output: {
    framework: 'arduino',
    outDir: './out',
  },
  toolchain: { type: 'arduino-cli' },
  // Upload port for `npm run upload`. Precedence: --port flag >
  // CUTTLEFISH_PORT env var > this config — Linux/macOS users can set
  // CUTTLEFISH_PORT=/dev/ttyACM0 instead of editing the file.
  console: { baudRate: 115200, port: 'COM6' },
  display: {
    profile: 'st7796-spi',
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
    colorOrder: 'bgr',
    invertDisplay: false,
    antialias: true,
    themeClass: 'dark',
    scroll: {
      dragScale: 1.0,
    },
    touch: {
      library: 'FT6336U',
      i2cAddress: 0x38,
      i2cFrequency: 400000,
      resetPin: 4,
      irq: 15,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
