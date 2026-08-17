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
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32',
  },
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },
  toolchain: {
    type: 'arduino-cli',
  },
  console: {
    baudRate: 9600,
  },
  console: { port: 'COM3' },
  display: {
    profile: 'ili9341-spi',
    cs: 5,
    dc: 21,
    rst: 22,
    backlight: 33,
    spiFrequency: 80000000,
    antialias: true,
    themeClass: 'dark',
    touch: {
      library: 'XPT2046_Touchscreen',
      cs: 15,
      irq: 17,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
      minPressure: 10,
    },
  },
};

export default config;
