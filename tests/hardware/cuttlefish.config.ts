import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Config for the @typecad/expect hardware HTTP test suite.
//
// This drives the @typecad/hal HTTP client on a real ESP32 against the local
// Node test server started by `npm run test:http` (see start-server.ts). The
// firmware connects to WiFi, then hits the server's /echo, /status/{code},
// /headers, and stateful /items routes over plain HTTP, verifying every verb
// with real CRUD mutations.
//
// Two-terminal flow:
//   Terminal 1:  npm run test:http --workspace @typecad/framework-zephyr
//   Terminal 2:  npm run test:hw:http --workspace @typecad/framework-zephyr -- --port COM9
//
// Run from this directory directly with:
//   cd tests/hardware && npx cuttlefish-test http-client.test.ts --port COM9
//
// Before flashing, edit the WIFI_SSID / WIFI_PASSWORD / *_URL constants at the
// top of each test file (or let `npm run test:http` write secrets.ts).
//
// Targets the Zephyr RTOS via west — the HTTP lowering lives in
// @typecad/framework-zephyr (src/lowering/http.ts). The ESP32 DevKitC is the
// sole networked target in this framework (the nRF52840 has no WiFi radio, so
// profileDiagnostics flags http usage there as 'zephyr-http-unavailable-on-
// target').

const config: CuttlefishConfig = {
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'esp32_devkitc/esp32/procpu',
  },
  toolchain: { type: 'west' },
  console: { baudRate: 115200 },
  // CONFIG_ESP32_USE_UNSUPPORTED_REVISION is required for the ESP32 DevKitC
  // rev in this workspace — mirrors packages/framework-zephyr/cuttlefish.config.ts.
  zephyr: {
    kconfig: { CONFIG_ESP32_USE_UNSUPPORTED_REVISION: 'y' },
  },
  test: {
    // Set via --port COM9 (or /dev/ttyUSB0 on Linux/macOS).
    port: '',
    baudRate: 115200,
    // WiFi connect (up to 30 s) + ~17 HTTP round-trips (verbs + status codes
    // + stateful CRUD) needs headroom over the default 30 s.
    timeout: 90000,
    include: ['*.test.ts'],
  },
};

export default config;
