// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite configuration
//
// Targets the Arduino Uno (ATmega328P / AVR). Each tests/*.test.ts file
// exercises one HAL subsystem and is transpiled + flashed via `cuttlefish-test`.
//
// Scope: AVR-compilable subsystems only. ESP32-only HAL APIs (DAC, FS,
// Power setCpuFrequency/deepSleep, HardwareTimer/Timer0–2) are intentionally
// omitted — they require an ESP32 target.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/01-gpio.test.ts',

  // Target architecture
  target: 'avr',
  // MCU package — provides silicon-level pin definitions
  mcu: '@typecad/mcu-atmega328p',

  // Board package — provides pin definitions and board constants
  board: '@typecad/board-arduino-uno',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-arduino',
  // Framework data
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },

  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  toolchain: {
    type: 'arduino-cli',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: 'COM9',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
