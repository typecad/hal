import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  entry: './tests/01-basics.test.ts',

  target: 'avr',

  // Board package — provides pin definitions and board constants
  board: '@typecode/board-arduino-uno',

  // Framework package — controls code generation strategy
  framework: '@typecode/framework-arduino',

  // Fully-Qualified Board Name for arduino-cli
  fqbn: 'arduino:avr:uno',

  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  toolchain: {
    type: 'arduino-cli',
    arduinoCli: {
      verbose: true,
    },
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: 'COM6',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
