// ---------------------------------------------------------------------------
// typecad-hal.config.ts — framework-zephyr hardware HAL tests (Nano 33 IoT)
//
// Runs the thin-HAL expect suite against a connected Arduino Nano 33 IoT
// (SAMD21). Test output rides the board's default console node (its
// devicetree `zephyr,console`). The old `console.output: 'usb'` rebinding
// is gone — the console.* carry-over was removed, and the console is board
// data again.
//
// Flashing rides the BOSSA bootloader with NO double-tap: the running
// firmware's USB shim reboots into the bootloader when the host touches the
// CDC port at 1200 baud (the board package's touchReset data), then bossac
// flashes the bootloader's own USB identity (2341:0057).
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './hal.test.ts',

  board: 'arduino_nano_33_iot/samd21g18a',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  // BOSSA bootloader route — the 1200-baud touch is automatic (see the
  // board package's usb.touchReset). No probe wiring; no debug.
  zephyr: {
    probe: 'bossac',
  },

  test: {
    port: '',
    baudRate: 115200,
    timeout: 60000,
    include: ['*.test.ts'],
  },
};

export default config;
