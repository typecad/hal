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
  // Uses board-arduino-uno which re-exports arch-avr-native for native codegen
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

  // Toolchain configuration (compile/upload backend)
  // Options: 'arduino-cli' (default) or 'platformio'
  toolchain: {
    type: 'platformio',
    // Arduino CLI specific options
    // arduinoCli: {
    //   path: '/path/to/arduino-cli',  // Optional: custom path
    //   configFile: './arduino-cli.yaml',  // Optional: custom config
    //   verbose: false,
    // },
    // PlatformIO specific options (when type: 'platformio')
    platformio: {
      // path: '/path/to/pio',  // Optional: custom path
      env: 'uno',  // Environment name from platformio.ini
    },
  },
};

export default config;
