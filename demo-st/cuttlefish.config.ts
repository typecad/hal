// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the ESP32 DevKit (ESP32-WROOM-32) via the Arduino ESP32 core. This
// demo scaffold is the home for upcoming UI-graphics work on this branch; it
// currently contains only a minimal blinky skeleton.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the single-file .ui component (script + style + template).
  // The transpiler splits it into TS/CSS/HTML streams internally.
  entry: './src/showcase.ui',

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

  // Display profile — ST7796S 320×480 SPI TFT + FT6336U I2C capacitive touch.
  display: {
    profile: 'st7796-spi',
    cs: 5,
    dc: 17,
    rst: 16,
    spiFrequency: 80000000,
    antialias: true,
    themeCss: 'C:/typecad/typecode/demo-ui/src/showcase.neobrutalism.css',
    themeClass: 'dark',
    touch: {
      library: 'FT6336U',
      i2cAddress: 0x38,
      resetPin: 4,
      irq: 14,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    },
  },
};

export default config;
