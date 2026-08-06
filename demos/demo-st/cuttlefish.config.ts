import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'esp32s3_devkitc/esp32s3/procpu' },
  // psram: 'opi',
  toolchain: { type: 'west' },
  console: { baudRate: 115200, port: 'COM12' },
  display: {
    profile: 'st7796-zephyr',
    // SPI display wiring — used by the Zephyr DT overlay to configure the
    // MIPI DBI SPI bridge's cs/dc/reset-gpios and the SPI bus frequency.
    // NOTE: the panel is on the devkitc's hardware SPI pins (SCLK=12,
    // MOSI=11, MISO=13), which are exactly the board's spim2_default
    // pinctrl — no spiPins override needed.
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
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
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
