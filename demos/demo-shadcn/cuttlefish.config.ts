// ---------------------------------------------------------------------------
// cuttlefish.config.ts — shadcn component-kit gallery
//
// Same ESP32 DevKit + ILI9341 wiring as demo-ui. The display theme is the
// shadcn kit itself: app.ui's <style> @imports src/styles/shadcn.css (the
// copy-and-own preset from `cuttlefish add shadcn`), and themeClass 'dark'
// selects the kit's dark token set — the iconic shadcn look. Flip to 'light'
// (or drop themeClass) to use the default light tokens; every recipe restyles
// from the variables alone.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/app.ui',

  board: 'esp32s3_devkitc/esp32s3/procpu',
  framework: '@typecad/framework-zephyr',

  // ESP32-S3 N16R8 has PSRAM. Uncomment to route large canvas allocations
  // (scroll viewports, lists) to external RAM instead of the SRAM
  // band-renderer path. Also enables the full-screen PSRAM framebuffer.
  psram: 'opi',

  display: {
    profile: 'st7796-zephyr',
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
    colorOrder: 'bgr',
    // ST7796S panel power-on default is already non-inverted; sending INVON
    // (0x21) would bitwise-NOT every pixel (red 0xF800 → cyan 0x07FF, etc.).
    // Leave inversion off — matches demo-st and the panel's native state.
    invertDisplay: false,
    themeClass: 'dark',  // same theme as demo-st for side-by-side comparison
    // FT6336U touch over Arduino Wire. Pin wiring matches demos/demo-st
    // exactly so the same hardware setup works for both demos.
    touch: {
      library: 'FT6336U',
      i2cAddress: 0x38,
      i2cFrequency: 400000,
      irq: 15,
      resetPin: 4,
      sda: 8,
      scl: 9,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
