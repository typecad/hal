// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: WeAct Black Pill V2.0 (STM32F411CEU6)
//
// One of the per-board configs in boards/ (selected via
// `cuttlefish-test --config boards/<board>.config.ts`, or from a board
// package with `npm run hal`). The suite itself is shared: tests/common/
// holds the board-agnostic groups and tests/board/ the role-driven groups —
// pin choices live in the board package's test-pins.json.
//
// Flashing goes through the ST-Link probe (SWD — `zephyr.probe: 'stlink'`,
// one of the board's named probe methods; no BOOT0 dance). Test output
// comes back over the board's USB-C connector (USB CDC-ACM console —
// `console.output: 'usb'` rebinds the Zephyr console onto cdc_acm_uart0,
// which also frees usart1 so the UART group can exercise UART0). The
// Preferences group exercises the ZMS-backed settings lowering against real
// on-chip flash (the synthesized storage_partition near the top of flash —
// see the board package's zephyr.storage).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'stm32f411',
  mcu: '@typecad/mcu-stm32f411',
  board: '@typecad/board-blackpill-f411ce',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'blackpill_f411ce/stm32f411xe',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-blackpill',
  },

  toolchain: {
    type: 'west',
  },

  // Console over the USB-C connector (CDC-ACM). Baud is irrelevant for USB
  // but kept for the serial open call.
  console: {
    output: 'usb',
    baudRate: 115200,
  },

  // Flash/debug via the ST-Link probe (SWD). 'stlink' resolves to the
  // openocd runner (with the reset_config quirk for unwired SRST living in
  // the board package). The board also supports: dfu (flash only), jlink,
  // stlink-srst (connect-under-reset).
  zephyr: {
    probe: 'stlink',
  },

  test: {
    // The Black Pill's USB-C CDC serial port. Override locally with --port.
    port: 'COM7',
    baudRate: 115200,
    timeout: 30000,
    // west flash resets the MCU, which re-enumerates the USB CDC port — give
    // Windows time to bring COM7 back before the reader opens it.
    serialOpenDelay: 3000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
