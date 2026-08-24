// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite configuration
//
// Targets the WeAct Black Pill V2.0 (STM32F411CEU6) via the Zephyr RTOS
// (west). Each tests/*.test.ts file exercises one HAL subsystem and is
// transpiled + flashed via `cuttlefish-test`. Run the whole suite or a
// single group:
//
//   npm run test:hw --workspace @typecad/hal                       # all groups
//   npm run test:hw:preferences --workspace @typecad/hal           # just prefs
//
// Flashing goes through the ST-Link probe (SWD — `zephyr.probe: 'stlink'`,
// one of the board's named probe methods; no BOOT0 dance). Test output
// comes back over the board's USB-C connector (USB CDC-ACM console —
// `console.output: 'usb'` rebinds the Zephyr console onto cdc_acm_uart0,
// which also frees usart1 so the UART group can exercise UART0). The
// Preferences group (14-preferences.test.ts) exercises the ZMS-backed
// settings lowering against real on-chip flash (the synthesized
// storage_partition near the top of flash — see the board package's
// zephyr.storage). The other groups (gpio, timing, …) drive the Zephyr
// devicetree-spec lowering for their respective peripherals.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/01-gpio.test.ts',

  // Target architecture / silicon / board
  target: 'stm32f411',
  mcu: '@typecad/mcu-stm32f411',
  board: '@typecad/board-blackpill-f411ce',

  // Framework package — Zephyr RTOS code generation
  framework: '@typecad/framework-zephyr',
  // Framework data — the Black Pill west build target.
  frameworkData: {
    buildTarget: 'blackpill_f411ce/stm32f411xe',
  },

  output: {
    framework: 'zephyr',
    outDir: './out',
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

  // Zephyr-specific: flash/debug via the ST-Link probe (SWD). 'stlink' is one
  // of the board's named probe methods and resolves to the openocd runner
  // (with the reset_config quirk for unwired SRST living in the board
  // package). The board also supports: dfu (flash only), jlink,
  // stlink-srst (connect-under-reset).
  zephyr: {
    probe: 'stlink',
  },

  test: {
    // The Black Pill's USB-C CDC serial port. Override locally with the
    // CUTTLEFISH_PORT env var (e.g. `CUTTLEFISH_PORT=/dev/ttyACM0 npm run test:hw`).
    port: 'COM7',
    baudRate: 115200,
    timeout: 30000,
    // west flash resets the MCU, which re-enumerates the USB CDC port — give
    // Windows time to bring COM7 back before the reader opens it.
    serialOpenDelay: 3000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
