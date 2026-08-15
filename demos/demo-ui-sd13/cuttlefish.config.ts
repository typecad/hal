// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the ESP32 DevKit (ESP32-WROOM-32) via the Arduino ESP32 core. This
// demo targets a 128x64 SSD1309-class OLED over I2C.
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

  // Upload port for `npm run upload`. Precedence: --port flag >
  // CUTTLEFISH_PORT env var > this config — Linux/macOS users can set
  // CUTTLEFISH_PORT=/dev/ttyACM0 instead of editing the file.
  console: { port: 'COM3' },

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

  // Display profile — describes the SSD1309 OLED capabilities and I2C wiring.
  display: {
    profile: 'ssd1309-i2c',
    bus: 'I2C',
    address: 0x3C,    // common OLED I2C address
    reset: -1,        // -1 if no reset pin wired
    rotation: 0,
  },
};

export default config;
