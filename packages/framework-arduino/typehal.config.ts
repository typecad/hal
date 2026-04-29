import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  entry: './tests/01-basics.test.ts',

  target: 'avr',

  // Board package — provides pin definitions and board constants
  board: '@typehal/board-arduino-uno',

  // Framework package — controls code generation strategy
  framework: '@typehal/framework-arduino',

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
    arduinoCli: {
      verbose: true,
    },
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: 'COM7',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
