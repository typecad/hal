// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the ESP32-S3 (dual-core Xtensa LX7 @ 240 MHz, Wi-Fi 4 + BLE 5,
// native USB-OTG). Compiles against the Arduino-ESP32 toolchain (xtensa-esp32s3
// gcc via `arduino-cli`).
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile. The transpiler wraps
  // top-level statements into `setup()` and synthesizes an empty `loop()`.
  entry: './src/main.ts',

  // Target architecture — ESP32-S3 (32-bit Xtensa LX7, STL available,
  // exceptions/RTTI available, dual-core).
  target: 'esp32s3',

  // MCU package — silicon-level pin/port definitions for the ESP32-S3.
  mcu: '@typecad/mcu-esp32s3',

  // Board package — ESP32-S3 board pin definitions and board constants.
  board: '@typecad/board-esp32s3',

  // Framework package — controls code generation strategy (setup/loop, Serial,
  // .ino output, ESP32-appropriate polyfills).
  framework: '@typecad/framework-arduino',

  // Build target — FQBN passed straight through to `arduino-cli compile`.
  // PSRAM=opi enables the octal PSRAM on N8R2/N16R8 modules (2 MB / 8 MB).
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32s3:PSRAM=opi',
  },

  // Output / build options.
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain — `arduino-cli` invokes xtensa-esp32s3-gcc from the installed
  // `esp32:esp32s3` core (no system-wide cross-compiler needed).
  toolchain: {
    type: 'arduino-cli',
  },

  // Console polyfill configuration — `Serial.begin(115200)` is injected at the
  // top of `setup()` so `console.log` reaches the serial monitor. Native
  // USB-CDC on GPIO19/GPIO20 is the default serial path on most S3 modules.
  console: {
    baudRate: 115200,
  },
};

export default config;
