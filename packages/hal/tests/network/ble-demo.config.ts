import type { TypecadConfig } from '@typecad/cuttlefish/api';

// Config for the @typecad/hal/testing hardware BLE test suite.
//
// This is the peripheral side of the inverted BLE test: it flashes
// ble-peripheral.test.ts, which advertises "CuttlefishTest" as a GATT server.
// The host central (tests/hardware/ble-client.ts, run via `npm run test:ble`)
// connects and exercises every characteristic.
//
// Two-terminal flow (mirrors the HTTP test's typecad-hal.config.ts):
//   Terminal 1 (peripheral):  npm run test:hw:ble -- --port COM14
//   Terminal 2 (central):     npm run test:ble
//
// Run from this directory directly with:
//   cd tests/hardware && npx typecad-hal test ble-peripheral.test.ts --port COM14
//
// Targets the Zephyr RTOS via west on the Seeed XIAO nRF52840 — a native BLE
// board (nRF52840, Cortex-M4F). The BLE lowering (@typecad/framework-zephyr
// src/lowering/ble.ts) uses Zephyr's bt_* GATT API, which is chip-neutral; the
// nRF52840 is the better BLE target (the ESP32 DevKitC requires the unsupported-
// rev kconfig and flashes over esptool, while the XIAO flashes over UF2).
//
// Upload uses the UF2 runner: the XIAO nRF52840 exposes a UF2 mass-storage
// bootloader, so `west flash --runner uf2` copies the firmware to the mounted
// drive — NOT a serial port. The --port flag is still used by the expect
// harness to read the test protocol over the board's USB-CDC serial after it
// reboots into the new firmware.
//
// The combined peripheral firmware that mirrors this test's GATT table lives at
// demos/ble-demo/src/08-test-server.ts — flash that standalone to debug the
// link without the expect harness.

const config: TypecadConfig = {
  // The connected ESP32-S3 devkitC: BLE via the Zephyr bt_* stack (esp32s3
  // supports BLE; the GATT lowering is chip-neutral). The board's WCH CH34x
  // USB-UART bridge carries esptool flashing AND the uart0 console — the test
  // identity matches the bridge (1A86:55D3), which never re-enumerates.
  // resetAfterOpen: the bridge's default DTR/RTS state holds the S3 in reset;
  // pulsing EN boots the app under the capture.
  target: 'esp32s3',
  board: 'esp32s3_devkitc/esp32s3/procpu',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'esp32s3_devkitc/esp32s3/procpu' },
  toolchain: { type: 'west' },
  console: { baudRate: 115200 },
  test: {
    usb: { vid: '0x1A86', pid: '0x55D3' },
    resetAfterOpen: true,
    port: '',
    baudRate: 115200,
    // BLE is slow: advertise + central scan + connect + GATT discovery + the
    // busy-waits in the test for connect/write/disconnect need headroom over
    // the default 30 s. ~90 s covers a sleepy adapter + a full suite pass.
    timeout: 180000,   // wide windows: connect(60s) + write(30s) + notify(30s) + disconnect(30s)
    include: ['ble-peripheral.test.ts'],
  },
};

export default config;
