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
  target: 'stm32f411',
  // MCU package — provides silicon-level pin definitions
  mcu: '@typecad/mcu-stm32f411',

  // Board package — provides pin definitions and board constants
  board: '@typecad/board-blackpill-f411ce',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-zephyr',
  // Framework data
  frameworkData: {
    buildTarget: 'blackpill_f411ce/stm32f411xe',
  },

  // Output / build options
  output: {
    framework: 'zephyr',
    outDir: './out',
  },

  // Toolchain configuration
  toolchain: {
    type: 'west',
  },

  // Console polyfill configuration
  console: {
    baudRate: 9600,
    // Serial port for upload/monitor. Override with --port on the CLI.
    port: 'COM4',
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
