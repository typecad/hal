import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// ESP32-S3 display demo — exercises the Adafruit ST7796S adapter over the
// Arduino-ESP32 core (arduino-cli), mirroring demos/demo-st so the same
// ESP32-S3 + ST7796S + FT6336U hardware setup works for both demos.
//
// Pin wiring matches demos/demo-st exactly (CS=5, DC=17, RST=16).
//
// FT6336U touch is enabled over Arduino Wire, matching demos/demo-st so the
// same hardware setup works for both demos.
const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    // Enable Octal PSRAM (ESP32-S3 module is N16R8 — 16 MB flash + 8 MB OPI
    // PSRAM). The showcase scroll viewports exceed the 88 KB internal-SRAM
    // canvas budget; PSRAM-backed canvases (ps_malloc under
    // #if defined(BOARD_HAS_PSRAM)) give them room to render smoothly.
    buildTarget: 'esp32:esp32:esp32s3:PSRAM=opi',
  },
  output: { framework: 'arduino', outDir: './out' },
  toolchain: { type: 'arduino-cli' },
  // Upload port for `npm run upload`. Precedence: --port flag >
  // CUTTLEFISH_PORT env var > this config — Linux/macOS users can set
  // CUTTLEFISH_PORT=/dev/ttyACM0 instead of editing the file.
  console: { port: 'COM6' },
  display: {
    profile: 'st7796-spi',
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
      resetPin: 4,
      irq: 15,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
