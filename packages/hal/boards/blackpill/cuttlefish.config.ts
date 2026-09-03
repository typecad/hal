// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: WeAct Black Pill V2.0 (STM32F411CEU6)
//
// The per-board config for the shared suite: tests/common/ holds the
// board-agnostic groups and tests/board/ the role-driven groups — pin choices
// live in this project's test-pins.json (resolved via the
// '@typecad/test-pins' virtual module), so board particularities are data,
// not per-board test copies.
//
// Flashing goes through the ST-Link probe (SWD — `zephyr.probe: 'stlink'`,
// the board's named probe method; no BOOT0 dance). Test output comes back
// over the board's USB-C connector (USB CDC-ACM console —
// `console.output: 'usb'` rebinds the Zephyr console onto cdc_acm_uart0,
// which also frees usart1 so the UART group can exercise UART0).
//
// Post-rework notes: the board comes from the Zephyr board catalog (no board
// package — `board:` is the fully-qualified west target), and every Zephyr
// CDC console enumerates at the Zephyr-test default identity 2FE3:0001.
// PWM and ADC run here: silicon routes are harvested from the SoC pinctrl
// files (tim*/adc* nodes), so the classes lower for real (test-pins.json
// carries the pwm/adcPin/adcPinAlt/adcMax roles).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/common/02-timing.test.ts',

  board: 'blackpill_f411ce/stm32f411xe',

  framework: '@typecad/framework-zephyr',

  output: {
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

  // Flash/debug via the ST-Link probe (SWD).
  zephyr: {
    probe: 'stlink',
  },

  test: {
    // Console found by USB identity — the Zephyr-test default every Zephyr
    // CDC board shares (per-board PIDs are gone). No COM tracking; the port
    // is re-resolved after every flash.
    usb: { vid: '2FE3', pid: '0001' },
    port: '',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
  },
};

export default config;
