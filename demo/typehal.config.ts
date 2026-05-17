// ---------------------------------------------------------------------------
// demo/typehal.config.ts - Demo Project Configuration for Arduino Uno (AVR)
// ---------------------------------------------------------------------------

import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/sketch.ts',

  // Target architecture (AVR for ATmega328P)
  target: 'avr',

  // ── CORE CONFIGURATION (Required) ───────────────────────────────────────
  // MCU package providing the underlying silicon definitions.
  mcu: '@typehal/mcu-atmega328p',

  // ── HARDWARE DEFINITION (Choose one) ────────────────────────────────────
  // Option A: Use a standard board package (Arduino Uno, ESP32 DevKit, etc.)
  board: '@typehal/board-arduino-uno',

  // Option B: Use a TypeCAD contract for custom hardware (narrows pins)
  // contract: './src/pro_mini.contract.json',

  // Framework package - controls code generation strategy
  framework: '@typehal/framework-arduino',

  // Framework data containing build target for arduino-cli
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },

  // Output / build options
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain configuration
  toolchain: {
    type: 'arduino-cli',
    frameworkOptions: {
      verbose: true,
    },
  },

  // Console polyfill configuration
  console: {
    baudRate: 115200,
  },

  // Hardware test configuration (used by typehal-test / @typehal/expect)
  test: {
    port: 'COM7',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'src/**/*.test.ts',
      'src/sketch.ts',
    ],
  },
};

export default config;