// ---------------------------------------------------------------------------
// typecad-hal.config.ts — framework-zephyr hardware HAL tests (`npm run hal`)
//
// Runs the thin-HAL expect suite against a connected STM32 Black Pill
// (WeAct F411CE). The board is found automatically by its USB CDC identity —
// the Zephyr-test default 2FE3:0001 (per-board PID assignment is gone; every
// Zephyr CDC board enumerates at the default, so the rig assumes one CDC
// board connected at a time) — and the port survives re-enumeration after
// every flash. No port is hardcoded; `--port` overrides if ever needed.
//
// Pipeline per file: preprocess (@typecad/hal/testing) → typecad-hal transpile →
// west build → west flash → serial capture on the CDC console → host-side
// assertion evaluation → vitest-style report.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './hal.test.ts',

  board: 'blackpill_f411ce/stm32f411xe',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  // Attach via ST-Link (SWD) — the board's named probe method that serves
  // flashing without the BOOT0 dance. One-off override for the ROM DFU
  // bootloader: npx typecad-hal build --compile --upload --probe dfu
  // (hold BOOT0 + reset first). jlink also works.
  zephyr: {
    probe: 'stlink',
  },

  // The test protocol prints ride the USB CDC console — no UART wiring.
  console: {
    output: 'usb',
    baudRate: 115200,
  },

  test: {
    // Auto-find the blackpill by its USB identity — the Zephyr-test default
    // (2FE3:0001). Re-resolved after every upload.
    usb: { vid: '0x2FE3', pid: '0x0001' },
    port: '',
    baudRate: 115200,
    timeout: 60000,
    include: ['*.test.ts'],
  },
};

export default config;
