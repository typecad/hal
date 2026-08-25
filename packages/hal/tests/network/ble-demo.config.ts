import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

// Config for the @typecad/expect hardware BLE test suite.
//
// This is the peripheral side of the inverted BLE test: it flashes
// ble-peripheral.test.ts, which advertises "CuttlefishTest" as a GATT server.
// The host central (tests/hardware/ble-client.ts, run via `npm run test:ble`)
// connects and exercises every characteristic.
//
// Two-terminal flow (mirrors the HTTP test's cuttlefish.config.ts):
//   Terminal 1 (peripheral):  npm run test:hw:ble -- --port COM14
//   Terminal 2 (central):     npm run test:ble
//
// Run from this directory directly with:
//   cd tests/hardware && npx cuttlefish-test ble-peripheral.test.ts --port COM14
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

const config: CuttlefishConfig = {
  target: 'nrf52',
  mcu: '@typecad/mcu-nrf52840',
  board: '@typecad/board-xiao-nrf52840',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'xiao_ble' },
  toolchain: { type: 'west' },
  console: { baudRate: 115200 },
  // UF2 mass-storage bootloader: west flash copies to the mounted drive, not a
  // serial port. An explicit zephyr.runner always wins over board.cmake's pick
  // (nrfjprog for xiao_ble), which would need a J-Link. The XIAO's native USB
  // bootloader is UF2 — double-tap reset to enter it before flashing.
  zephyr: {
    runner: 'uf2',
  },
  test: {
    // Set via --port COM14 (the board's USB-CDC serial, used to read the test
    // protocol after the UF2 flash reboots the board).
    port: '',
    baudRate: 115200,
    // BLE is slow: advertise + central scan + connect + GATT discovery + the
    // busy-waits in the test for connect/write/disconnect need headroom over
    // the default 30 s. ~90 s covers a sleepy adapter + a full suite pass.
    timeout: 90000,
    include: ['ble-peripheral.test.ts'],
  },
};

export default config;
