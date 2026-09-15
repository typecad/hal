// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Stage 2 mono demo: SSD1306 128x64 over I2C.
//
// The SAME .ui authoring surface as the color demos; the build flattens it
// to 1bpp (colors → luminance threshold, radii → square, shadows/opacity
// dropped, :pressed → face inversion) and renders full-frame — a 1KB frame
// pushed whole each refresh. The preview shows exactly this flattening.
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/app.ui',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },

  display: {
    profile: 'ssd1306-zephyr',
    address: 0x3c,
    themeClass: 'dark',
  },
};

export default config;
