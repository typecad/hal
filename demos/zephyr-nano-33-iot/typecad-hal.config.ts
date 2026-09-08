// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Arduino Nano 33 IoT demo (SAMD21G18A)
//
// Analog LED dimmer: A0 (PA2 / ADC AIN0) → the onboard LED (PA17) as a PWM
// dimmer (TCC2/WO1, the board's `pwm-led0` DT alias), with periodic USB CDC
// reports over the micro-USB connector. Exercises the SAMD21-specific
// lowering: the per-port porta/portb controller split, the board-shipped
// pwm-led0 spec, and the sam0 ADC channel setup (ADC_GAIN_1 +
// ADC_REF_VDD_1_2 — reads saturate above ~1650 mV; see the board package).
//
// Pipeline: typecad-hal build → out/src/main.cpp → west build → west flash.
// Flashed over the built-in BOSSA USB bootloader (double-tap reset, no
// probe needed) — or openocd/jlink on the underside SWD pads for debugging.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',

  // Target architecture

  // MCU package — provides silicon-level pin definitions

  // Board package — provides pin definitions and board constants
  board: 'arduino_nano_33_iot/samd21g18a',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-zephyr',
  // Framework data
  // Output / build options
  output: {
    outDir: './out',
  },

  // Toolchain configuration
  // Zephyr-specific: flash over the built-in USB bootloader. 'bossac' is one
  // of the board's named probe methods — put the board in bootloader mode
  // (double-tap reset) before `--upload`. It cannot debug; for that use the
  // 'openocd' or 'jlink' methods on the underside SWD pads. One-off
  // overrides:
  //   npx typecad-hal build --compile --upload --probe openocd
  zephyr: {
    probe: 'bossac',
  },

  // Console polyfill configuration. The board's default console is sercom5
  // on the D0/D1 header pins; 'usb' rebinds console.log onto the USB CDC
  // port so the demo needs no wiring at all.

  // Hardware test runner (@typecad/hal/testing / `npm run test:hw`)
  test: {
    // Serial port for the test board. Before the first typecad-hal flash the
    // board enumerates with Arduino's USB identity — set the port explicitly
    // (or use test.usb with the default 2FE3:0001 once typecad-hal firmware
    // is on it). Override with --port on the CLI.
    port: 'COM8',
    baudRate: 115200,
    timeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
};

export default config;
