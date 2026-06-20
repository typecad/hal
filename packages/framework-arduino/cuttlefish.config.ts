import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './tests/01-basics.test.ts',

  target: 'esp32',

  // MCU package — silicon-level pin/port definitions for the ESP32-WROOM-32.
  mcu: '@typecad/mcu-esp32',

  // Board package — ESP32 DevKit pin definitions, aliases (D0/D13, A0–A5), and
  // peripheral mappings (I2C/SPI/UART buses).
  board: '@typecad/board-esp32-devkit',

  // Framework package — controls code generation strategy (setup/loop, Serial,
  // .ino output).
  framework: '@typecad/framework-arduino',

  // Build target — FQBN passed straight through to `arduino-cli compile`.
  // Matches the board package's `build.frameworks.arduino` value.
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32',
  },

  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  toolchain: {
    type: 'arduino-cli',
  },

  console: {
    baudRate: 115200,
  },

  test: {
    port: 'COM3',
    baudRate: 115200,
    timeout: 30000,
    include: [
      'tests/**/*.test.ts',
    ],
  },
};

export default config;
