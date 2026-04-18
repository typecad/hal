// ---------------------------------------------------------------------------
// demo/typecode.config.ts - Demo Project Configuration for Arduino Uno
// ---------------------------------------------------------------------------

import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/sketch.ts',

  // Target architecture (AVR for ATmega328P)
  target: 'avr',

  // Board package - provides pin definitions and board constants
  board: '@typecode/board-arduino-uno',

  // Framework package - controls code generation strategy
  // Options: '@typecode/framework-arduino' (digitalWrite, etc.)
  //          '@typecode/framework-avr' (native registers: PORTB, etc.)
  framework: '@typecode/framework-arduino',

  // Fully-Qualified Board Name for arduino-cli
  fqbn: 'arduino:avr:uno',

  // Output / build options
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain configuration
  toolchain: {
    type: 'arduino-cli',
    arduinoCli: {
      verbose: true,
    },
  },

  // Console polyfill configuration
  console: {
    baudRate: 115200,
  },

  // Hardware test configuration (used by typecode-test / @typecode/expect)
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