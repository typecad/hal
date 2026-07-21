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
    // The ST7796S native display adapter uses the IDF spi_master driver, which
    // lives in the esp_driver_spi component (IDF v5+). The framework doesn't
    // yet auto-add this component based on the active display driver — track
    // as a follow-up. Declared here explicitly so the demo compiles.
    components: { builtin: ['esp_driver_spi'] },
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
    invertDisplay: false,
    // NO touch block — native touch shim port is deferred.
  },
};

export default config;
