// ---------------------------------------------------------------------------
// demo/typehal.config.ts - Demo Project Configuration for ESP32 DevKit
// ---------------------------------------------------------------------------

import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/sketch.ts',

  // Target architecture (ESP32 for ESP32-WROOM-32)
  target: 'esp32',

  // Board package - provides pin definitions and board constants
  board: '@typehal/board-arduino-uno',

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
    port: 'COM6',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'src/**/*.test.ts',
      'src/sketch.ts',
    ],
  },
};

export default config;