import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32s3:PSRAM=opi',
  },
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
      // defines: { UI_USE_FULL_FRAMEBUFFER: '1' },   // <- enable here

  },
  toolchain: { type: 'arduino-cli' },
  console: { baudRate: 9600 },
  display: {
    profile: 'st7796-spi',
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
    colorOrder: 'bgr',
    invertDisplay: false,
    antialias: true,
    // themeCss: './src/showcase.neobrutalism.css',
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
