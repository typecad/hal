// ---------------------------------------------------------------------------
// demo/typecode.config.ts - Demo Project Configuration for Arduino Uno
// ---------------------------------------------------------------------------

import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  // Target architecture (AVR for ATmega328P)
  target: 'avr',

  // Board package - Arduino Uno with Arduino framework
  board: 'packages/board-arduino-nano',

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
      verbose: false,
    },
  },

  // Console polyfill configuration
  console: {
    baudRate: 115200,
  },
};

export default config;