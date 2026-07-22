import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Native ESP32 display demo — exercises the framework-esp32 ST7796S adapter
// (no Adafruit, no Arduino-ESP32 core dependency for displays).
//
// Pin wiring matches demos/demo-st exactly (CS=5, DC=17, RST=16) so the same
// ESP32-S3 + ST7796S hardware setup works for both Adafruit (arduino-cli) and
// native (ESP-IDF) paths.
//
// Touch is DISABLED — the FT6336U touch shim still hardcodes Arduino Wire
// (see display-profile.ts:487-528). Native touch port is deferred.
const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-esp32',
  frameworkData: {
    buildTarget: 'esp32s3',
    // Enable Octal PSRAM (ESP32-S3 module is N16R8 — 16 MB flash + 8 MB OPI
    // PSRAM). The showcase scroll viewports exceed the 88 KB internal-SRAM
    // canvas budget; PSRAM-backed canvases (ps_malloc under
    // #if defined(BOARD_HAS_PSRAM)) give them room to render smoothly.
    psram: 'opi',
    // The ST7796S native display adapter uses the IDF spi_master driver, and
    // the FT6336U touch adapter uses i2c_master. The framework doesn't auto-add
    // these components yet — declared explicitly so the demo compiles.
    components: { builtin: ['esp_driver_spi', 'esp_driver_i2c'] },
  },
  output: { framework: 'esp32', optimize: 'size', outDir: './out' },
  toolchain: { type: 'idf' },
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
    // Native FT6336U touch (I2C via esp_driver_i2c). Pin wiring matches
    // demos/demo-st exactly so the same hardware setup works for both paths.
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
