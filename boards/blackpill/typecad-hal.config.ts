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
// the board's named probe method; no BOOT0 dance). Test output rides the
// board's default console node (its devicetree `zephyr,console` — usart1
// on PA9/PA10). The old `console.output: 'usb'` rebinding is gone: the
// console.* carry-over was removed, and the console is board data again.
//
// Post-rework notes: the board comes from the Zephyr board catalog (no board
// package — `board:` is the fully-qualified west target).
// PWM and ADC run here: silicon routes are harvested from the SoC pinctrl
// files (tim*/adc* nodes), so the classes lower for real (test-pins.json
// carries the pwm/adcPin/adcPinAlt/adcMax roles).
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './tests/common/02-timing.test.ts',

  board: 'blackpill_f411ce/stm32f411xe',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out-blackpill',
  },

  toolchain: {
    type: 'west',
  },

  // Flash/debug via the ST-Link probe (SWD).
  zephyr: {
    probe: 'stlink',
  },

  test: {
    // Serial port for the test capture — the board's console UART (usart1),
    // typically through a USB-UART dongle. Set here, with --port, or via
    // TYPECAD_HAL_PORT.
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
