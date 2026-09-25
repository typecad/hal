// ---------------------------------------------------------------------------
// typecad-hal.config.ts — USB HID random typist (ESP32-S3 DevKitC)
//
// The keyboard demo for the new HID surface: the board enumerates as a USB
// keyboard and taps a random key every 5–15 seconds. The typing IS the
// output — no console needed — which also keeps the device a single HID
// interface (the v1 ceiling: Keyboard OR Mouse per program, not both).
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  // ESP32-S3 DevKitC PROCPU — the USB device controller (zephyr_udc0) is
  // what carries the HID interface; the board module exports Keyboard/KEY
  // only because of it.
  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out',
  },

  toolchain: {
    type: 'west',
  },

};

export default config;
