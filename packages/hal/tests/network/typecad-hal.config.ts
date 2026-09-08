import type { TypecadConfig } from '@typecad/cuttlefish/api';

// Config for the @typecad/hal/testing hardware HTTP test suite.
//
// This drives the @typecad/hal HTTP client on a real ESP32 against the local
// Node test server started by `npm run test:http` (see start-server.ts). The
// firmware connects to WiFi, then hits the server's /echo, /status/{code},
// /headers, and stateful /items routes over plain HTTP, verifying every verb
// with real CRUD mutations.
//
// Two-terminal flow:
//   Terminal 1:  npm run test:http (repo root)
//   Terminal 2:  npm run test:hw:http -- --port COM9 (repo root)
//
// Run from this directory directly with:
//   cd packages/hal/tests/network && npx typecad-hal test http-client.test.ts --port COM9
//
// Before flashing, edit the WIFI_SSID / WIFI_PASSWORD / *_URL constants at the
// top of each test file (or let `npm run test:http` write secrets.ts).
//
// Targets the Zephyr RTOS via west — the HTTP lowering lives in
// @typecad/framework-zephyr (src/lowering/http.ts). The ESP32 DevKitC is the
// sole networked target in this framework (the nRF52840 has no WiFi radio, so
// profileDiagnostics flags http usage there as 'zephyr-http-unavailable-on-
// target').

const config: TypecadConfig = {

  board: 'esp32s3_devkitc/esp32s3/procpu',
  framework: '@typecad/framework-zephyr',
  console: { baudRate: 115200 },
  // CONFIG_ESP32_USE_UNSUPPORTED_REVISION is required for the ESP32 DevKitC
  // rev in this workspace — mirrors packages/hal/boards/esp32-devkit.config.ts.
  zephyr: {
  },
  test: {
    // The CH34x bridge identity — resolves before AND after flashing.
    usb: { vid: '0x1A86', pid: '0x55D3' },
    resetAfterOpen: true,
    port: '',
    baudRate: 115200,
    // WiFi connect (up to 30 s) + ~17 HTTP round-trips (verbs + status codes
    // + stateful CRUD) needs headroom over the default 30 s.
    timeout: 90000,
    include: ['*.test.ts'],
  },
};

export default config;
