import type { TypeCADConfig } from '@typecad/hal';

const config: TypeCADConfig = {
  entry: './tests/01-basics.test.ts',

  target: 'avr',

  // Board package — provides pin definitions and board constants
  board: '@typecad/board-arduino-uno',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-arduino',

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
