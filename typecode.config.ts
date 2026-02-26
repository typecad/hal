// ---------------------------------------------------------------------------
// typecode.config.ts — Project configuration
//
// This file tells the typecode transpiler which board, architecture, and
// build options to use when converting TypeScript → C++.
// ---------------------------------------------------------------------------

import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  // Target architecture
  target: 'avr',

  // Board package (npm specifier)
  board: '@typecode/board-arduino-uno',

  // Fully-Qualified Board Name for arduino-cli
  fqbn: 'arduino:avr:uno',

  // Output / build options
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Hardware test runner (@typecode/expect)
  test: {
    port: 'COM4',
    include: ['examples/**/*.test.ts'],
    baudRate: 115200,
    timeout: 30000,
  },
};

export default config;
