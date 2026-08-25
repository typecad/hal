import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Each demo in src/ is a standalone entry — point `entry` at the one to build:
  //   01-minimal-server.ts   minimal: advertise + one read-only characteristic
  //   02-configured.ts       TX power + multiple read/write characteristics
  //   03-async.ts            cooperative wait-for-connect + heartbeat (state machine)
  //   04-notify.ts           notify push to subscribed clients
  //   05-multi-service.ts    multiple services (Environmental Sensing + Battery)
  //   06-custom-uuid.ts      128-bit vendor-specific UUIDs
  //   07-status.ts           connection monitoring + status queries
  //   08-test-server.ts      combined peripheral for the on-hardware BLE suite
  //                          (mirrors packages/hal/tests/network/ble-peripheral.test.ts)
  entry: './src/08-test-server.ts',
  // Seeed XIAO nRF52840 — a native BLE board. Flashes via UF2 (mass-storage
  // bootloader); double-tap reset to enter it. See packages/hal/tests/network/README.md.
  target: 'nrf52',
  mcu: '@typecad/mcu-nrf52840',
  board: '@typecad/board-xiao-nrf52840',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'xiao_ble/nrf52840' },
  output: { outDir: './out' },
  toolchain: { type: 'west' },
  console: { baudRate: 115200 },
  zephyr: {
    runner: 'uf2',
  },
};

export default config;
