// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the ESP32 DevKit (ESP32-WROOM-32) via the Arduino ESP32 core. This
// demo scaffold is the home for upcoming UI-graphics work on this branch; it
// currently contains only a minimal blinky skeleton.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile. The transpiler wraps
  // top-level statements into `setup()` and synthesizes an empty `loop()`.
  entry: './src/main.ts',

  // Target architecture — ESP32 (32-bit Xtensa LX6, STL available, FreeRTOS
  // under the Arduino core).
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

  // Output / build options.
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain — `arduino-cli` invokes xtensa-esp32-elf-g++ from the installed
  // `esp32:esp32` core (no system-wide toolchain needed).
  toolchain: {
    type: 'arduino-cli',
  },

  // Console polyfill configuration — `Serial.begin(115200)` is injected at the
  // top of `setup()` so `console.log` reaches the serial monitor.
  console: {
    baudRate: 9600,
  },

  // Display profile — describes the ILI9341's capabilities and wiring.
  display: {
    profile: 'ili9341-spi',
    cs: 5,
    dc: 4,
    rst: 22,
    backlight: 15,
    touch: {
      library: 'XPT2046_Touchscreen',
      interface: 'spi-hw',
      cs: 14,
      irq: 2,
      calibration: { xMin: 230, xMax: 3700, yMin: 350, yMax: 3900 },
      minPressure: 10,
    },
  },
};

export default config;
