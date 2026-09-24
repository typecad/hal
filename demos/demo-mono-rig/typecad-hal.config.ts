// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Stage 2 mono rig test.
//
// Hardware: ESP32-S3 (esp32s3_devkitc/procpu) + SSD1309 128x64 I2C OLED,
// SCL = GPIO16, SDA = GPIO17, address 0x3c. The drop-in driver exercises the
// full Stage 2 path: solomon,ssd1309 binding harvest, mono synthesis via the
// compatible table (colorFormatForDriver — no explicit colorFormat needed),
// the I2C pinctrl remux, the full-frame 1bpp adapter, and the vtiled
// display_write stream the ssd1309 driver consumes.
//
// Flash: npm run upload  (or: npx typecad-hal build --compile --upload)
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/app.ui',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',

  // Runtime tracing: the heartbeat reports CPU/stack per thread AND UI
  // frame stats (count/avg/max per interval) — `typecad-hal trace capture`
  // + `trace report`/`trace view` on the device's USB serial port.
  zephyr: {
    trace: { enabled: true, intervalMs: 1000 },
  },

  output: {
    outDir: './out',
  },

  display: {
    driver: 'solomon,ssd1309',
    // Explicit: the device build infers mono from the driver, but the
    // preview server has no framework strategy — without this the browser
    // renders an rgb565 approximation.
    colorFormat: 'mono',
    width: 128,
    height: 64,
    address: 0x3c,
    i2cPins: { sda: 17, scl: 16 },
    themeClass: 'dark',
  },
};

export default config;
