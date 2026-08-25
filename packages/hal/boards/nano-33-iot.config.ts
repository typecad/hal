// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: Arduino Nano 33 IoT (SAMD21G18A)
//
// One of the per-board configs in boards/ (selected via
// `cuttlefish-test --config boards/<board>.config.ts`, or from a board
// package with `npm run hal`). The suite itself is shared: tests/common/
// holds the board-agnostic groups and tests/board/ the role-driven groups —
// pin choices live in the board package's test-pins.json.
//
// Flashing goes through the built-in USB bootloader (bossac — double-tap
// reset puts the board in the SamBA/BOSSA bootloader; `zephyr.probe:
// 'bossac'` is one of the board's named probe methods, no probe wiring
// needed). Test output comes back over the same USB connector (USB CDC-ACM
// console — `console.output: 'usb'` rebinds the Zephyr console onto
// cdc_acm_uart0, which also frees sercom5 so the UART group can exercise
// UART0 on the D0/D1 header pins).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'samd21',
  mcu: '@typecad/mcu-samd21',
  board: '@typecad/board-nano-33-iot',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'arduino_nano_33_iot/samd21g18a',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-nano33iot',
  },

  toolchain: {
    type: 'west',
  },

  // Console over the micro-USB connector (CDC-ACM). Baud is irrelevant for
  // USB but kept for the serial open call.
  console: {
    output: 'usb',
    baudRate: 115200,
  },

  // Flash via the built-in USB bootloader (bossac — double-tap reset
  // first). The board also supports openocd/jlink SWD debugging on the
  // underside pads (see the board package's probeMethods).
  zephyr: {
    probe: 'bossac',
  },

  test: {
    // Console found by USB identity (the board package's CDC PID) — no COM
    // tracking. After each bossac flash the port re-enumerates and is
    // re-resolved; the explicit port below is only the bootstrap fallback
    // for firmware flashed before the PID assignment. Override with --port.
    usb: { vid: '2FE3', pid: '0003' },
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    // bossac resets the MCU, which re-enumerates the USB CDC port — give
    // Windows time to bring the port back before the reader opens it.
    serialOpenDelay: 3000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
