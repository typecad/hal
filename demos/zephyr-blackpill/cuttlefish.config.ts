// ---------------------------------------------------------------------------
// cuttlefish.config.ts — STM32 Black Pill demo (WeAct Black Pill V2.0)
//
// Analog light-dimmer: PA1 (ADC1_IN1) → PB6 (TIM4_CH1 PWM), LED heartbeat,
// KEY button mode toggle. Exercises the STM32-specific lowering: the
// per-port gpioa/gpiob/gpioc controller split, the synthesized PWM alias,
// and the ADC channel setup (ADC_GAIN_1 + ADC_REF_INTERNAL).
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// Flashed over USB via the ROM DFU bootloader (BOOT0 + reset) — no probe.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',

  // Target architecture

  // MCU package — provides silicon-level pin definitions

  // Board package — provides pin definitions and board constants
  board: 'blackpill_f411ce/stm32f411xe',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-zephyr',
  // Framework data
  // Output / build options
  output: {
    outDir: './out',
  },

  // Toolchain configuration
  // Zephyr-specific: attach via ST-Link (SWD) instead of the board's default
  // dfu-util runner. 'stlink' is one of the board's named probe methods — it
  // serves BOTH flashing and debugging, and resolves to the openocd runner
  // plus the args the method needs (the reset_config quirk for unwired SRST
  // lives in the board package, not here). The board also supports: dfu
  // (flash only), jlink. One-off overrides:
  //   npx cuttlefish build --compile --upload --probe dfu
  zephyr: {
    probe: 'stlink',
  },


  // Hardware test runner (@typecad/expect / `npm run test:hw`)
  test: {
    // Serial port for the test board. Override with --port on the CLI or the
    // CUTTLEFISH_PORT env var (e.g. CUTTLEFISH_PORT=/dev/ttyUSB0 npm run test:hw).
    port: 'COM4',
    baudRate: 9600,
    timeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
};

export default config;
