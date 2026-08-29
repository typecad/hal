// ---------------------------------------------------------------------------
// cuttlefish.config.ts — framework-zephyr hardware HAL tests (`npm run hal`)
//
// Runs the thin-HAL expect suite against a connected STM32 Black Pill
// (WeAct F411CE). The board is found automatically by its USB CDC identity
// (VID 2FE3 / PID 0002 — the board package's declared `usb` block), so the
// port survives re-enumeration after every flash. No port is hardcoded;
// `--port` overrides if ever needed.
//
// Pipeline per file: preprocess (@typecad/expect) → cuttlefish transpile →
// west build → west flash → serial capture on the CDC console → host-side
// assertion evaluation → vitest-style report.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './hal.test.ts',

  board: 'blackpill_f411ce/stm32f411xe',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  // Attach via ST-Link (SWD) — the board's named probe method that serves
  // flashing without the BOOT0 dance. One-off override for the ROM DFU
  // bootloader: npx cuttlefish build --compile --upload --probe dfu
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
    // Auto-find the blackpill by its USB identity (the board package's
    // declared vid/pid). Re-resolved after every upload.
    usb: { vid: '0x2FE3', pid: '0x0002' },
    port: '',
    baudRate: 115200,
    timeout: 60000,
    include: ['*.test.ts'],
  },
};

export default config;
