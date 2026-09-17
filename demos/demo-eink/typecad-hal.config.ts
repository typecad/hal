// Stage 4 e-ink demo — SSD1680-class 296x176 EPD over SPI (the common
// "Waveshare-style" 296x176 module wiring; adjust pins for your module).
// Compile-verified; hardware verification awaits a panel.
import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/app.ui',

  framework: '@typecad/framework-zephyr',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  display: {
    driver: 'solomon,ssd1680',
    width: 296,
    height: 176,
    // Common module wiring: SPI2 on the DevKitC header + control GPIOs.
    spiPins: { sck: 12, mosi: 11, miso: 13, cs: 10 },
    dc: 8,
    rst: 14,
    busyPin: 21,
    rotation: 0,
  },
};

export default config;
