// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: Seeed XIAO nRF52840
//
// Runs the shared suite (tests/common + tests/board) through the Zephyr RTOS
// on the XIAO's nRF52840. Console goes over the board's native USB (CDC-ACM).
// The pwm group self-skips: the board's PWM surface is the pwm-led0 DT spec
// only (the mcu package maps no generic PWM channels yet), so its
// test-pins.json declares no `pwm` role.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  target: 'nrf52840',
  mcu: '@typecad/mcu-nrf52840',
  board: '@typecad/board-xiao-nrf52840',

  framework: '@typecad/framework-zephyr',
  frameworkData: {
    buildTarget: 'xiao_ble',
  },

  output: {
    framework: 'zephyr',
    outDir: './out-xiao',
  },

  toolchain: {
    type: 'west',
  },

  console: {
    output: 'usb',
    baudRate: 115200,
  },

  test: {
    // The XIAO's USB-C CDC serial port. Override locally with --port.
    port: 'COM14',
    baudRate: 115200,
    timeout: 30000,
    serialOpenDelay: 3000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
