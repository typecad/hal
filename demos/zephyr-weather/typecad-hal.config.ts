// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Weather station UI on Zephyr (ESP32-S3)
//
// The Zephyr port of demos/demo-weather: the same BME688-style weather UI
// (mocked sensor signals bound to the template), on the shared ST7796S rig
// through the framework-zephyr display path.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  console: {
    baudRate: 115200,
    port: 'COM9',
  },

  display: {
    profile: 'st7796-zephyr',
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
    rotation: 1,
    antialias: true,
    colorOrder: 'bgr',
    invertDisplay: false,
    themeClass: 'dark',
    touch: {
      library: 'FT6336U',
      i2cAddress: 0x38,
      i2cFrequency: 400000,
      sda: 8,
      scl: 9,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
