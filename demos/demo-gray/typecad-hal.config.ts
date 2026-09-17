// Stage 3 gray8 demo — SSD1327-class 16-gray OLED over I2C (the same rig
// wiring as demo-mono-features: ESP32-S3, SCL=16 SDA=17, address 0x3c).
// Compile-verified; adjust width/height when a physical module lands
// (SSD1327 modules ship 128x128 or 128x96).
import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/app.ui',

  framework: '@typecad/framework-zephyr',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  display: {
    driver: 'solomon,ssd1327',
    colorFormat: 'gray8',
    width: 128,
    height: 128,
    address: 0x3c,
    i2cPins: { sda: 17, scl: 16 },
  },
};

export default config;
