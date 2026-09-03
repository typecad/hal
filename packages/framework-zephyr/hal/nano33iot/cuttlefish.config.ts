// ---------------------------------------------------------------------------
// cuttlefish.config.ts — framework-zephyr hardware HAL tests (Nano 33 IoT)
//
// Runs the thin-HAL expect suite against a connected Arduino Nano 33 IoT
// (SAMD21). The board is found automatically by its USB CDC identity —
// the Zephyr-test default 2FE3:0001 (per-board PID assignment is gone;
// every Zephyr CDC board enumerates at the default, so the rig assumes
// one CDC board connected at a time).
//
// Flashing rides the BOSSA bootloader with NO double-tap: the running
// firmware's USB shim reboots into the bootloader when the host touches the
// CDC port at 1200 baud (the board package's touchReset data), then bossac
// flashes the bootloader's own USB identity (2341:0057) and the board
// re-enumerates as 2FE3:0001 for the serial capture.
//
// console.output: 'usb' both carries the test protocol AND frees sercom5
// (D0/D1) for the thin UART test.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
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

  console: {
    output: 'usb',
    baudRate: 115200,
  },

  test: {
    // Auto-find by USB identity (the Zephyr-test default 2FE3:0001);
    // re-resolved after every upload.
    usb: { vid: '0x2FE3', pid: '0x0001' },
    port: '',
    baudRate: 115200,
    timeout: 60000,
    include: ['*.test.ts'],
  },
};

export default config;
