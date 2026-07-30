import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Config for the @typecad/expect hardware test suite.
// These tests run on a real ESP32 over serial — see tests/hardware/*.test.ts.
//
// Run with:
//   cd tests/hardware
//   npx cuttlefish-test --port COM4 http-client.test.ts
//
// Before running, edit the WIFI_SSID / WIFI_PASSWORD / TEST_KEY constants
// at the top of each test file.

const config: CuttlefishConfig = {
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32s3' },
  toolchain: { type: 'arduino-cli' },
  console: { baudRate: 115200 },
  test: {
    // Set via --port COM4 (or /dev/ttyUSB0 on Linux/macOS).
    port: '',
    baudRate: 115200,
    // WiFi connect (up to 30 s) + ~8 HTTPS round-trips needs headroom
    // over the default 30 s.
    timeout: 90000,
    include: ['*.test.ts'],
  },
};

export default config;
