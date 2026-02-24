// ---------------------------------------------------------------------------
// typecode.config.ts — Project configuration
//
// This file tells the typecode transpiler which board, architecture, and
// build options to use when converting TypeScript → C++.
// ---------------------------------------------------------------------------

import type { TypecodeConfig } from './code/core/config';

const config: TypecodeConfig = {
  // Target architecture
  target: 'avr',

  // Board package (resolves to code/board-arduino-uno)
  board: './code/board-arduino-uno',

  // Fully-Qualified Board Name for arduino-cli
  fqbn: 'arduino:avr:uno',

  // Output / build options
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },
};

export default config;
