// ---------------------------------------------------------------------------
// cuttlefish.config.ts — ESP32-S3 display showcase on Zephyr
//
// The Zephyr port of demos/demo-display: the same .ui showcase and the same
// hardware (ESP32-S3 + ST7796S + FT6336U touch; CS=5, DC=17, RST=16), with
// the framework-zephyr display path — the st7796-zephyr profile over
// <zephyr/drivers/display.h> and the strategy-owned FT6336U touch adapter,
// instead of the Adafruit ST7796S adapter over the Arduino-ESP32 core.
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/showcase.ui',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },

  display: {
    profile: 'st7796-zephyr',
    cs: 5,
    dc: 17,
    rst: 16,
    // Hz — lower this if the panel glitches
    spiFrequency: 80000000,
    rotation: 1,
    antialias: true,
    colorOrder: 'bgr',
    // ST7796S panel power-on default is already non-inverted; sending INVON
    // would bitwise-NOT every pixel. Leave inversion off (matches
    // demos/demo-display and demos/zephyr-debug).
    invertDisplay: false,
    themeClass: 'dark',   // same theme as demo-display for side-by-side
    // FT6336U capacitive touch over I2C — the strategy-owned zephyr touch
    // adapter. SDA=8 / SCL=9 per the shared demo rig's wiring (demo-st and
    // demo-display; NOT the board dts's i2c0_default of GPIO1/2).
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
