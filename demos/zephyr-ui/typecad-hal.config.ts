// ---------------------------------------------------------------------------
// typecad-hal.config.ts — UI showcase on Zephyr (ESP32-S3)
//
// The Zephyr port of demos/demo-ui: the same showcase.ui + neobrutalism theme
// assets, built through the framework-zephyr display path. The panel here is
// the ST7796S rig (CS=5, DC=17, RST=16 — shared with demo-display/zephyr-debug)
// with FT6336U touch on SDA8/SCL9, since ILI9341+XPT2046-on-arduino-uno-wiring
// was an Arduino-core-specific wiring; the showcase theme renders unchanged.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/showcase.ui',

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
    themeClass: 'dark',   // showcase.neobrutalism.css drives the look
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
