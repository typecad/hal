// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Project configuration
//
// Targets the Arduino Uno (ATmega328P, AVR core). This is the FIRST demo to
// compile against the Arduino AVR toolchain (avr-gcc via `arduino-cli`); every
// prior demo (#1–#32) compiled against the native `g++` toolchain.
// ---------------------------------------------------------------------------

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Entry point — the main TypeScript file to transpile. The transpiler wraps
  // top-level statements into `setup()` and synthesizes an empty `loop()`.
  entry: './src/main.ts',

  // Target architecture — AVR (8-bit ATmega, `int` is 16-bit, no STL by
  // default, no exceptions/RTTI).
  target: 'avr',

  // MCU package — silicon-level pin/port definitions for the ATmega328P.
  mcu: '@typecad/mcu-atmega328p',

  // Board package — Arduino Uno pin definitions and board constants.
  board: '@typecad/board-arduino-uno',

  // Framework package — controls code generation strategy (setup/loop, Serial,
  // .ino output, AVR-appropriate polyfills).
  framework: '@typecad/framework-arduino',

  // Build target — FQBN passed straight through to `arduino-cli compile`.
  frameworkData: {
    buildTarget: 'arduino:avr:uno',
  },

  // Output / build options.
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },

  // Toolchain — `arduino-cli` invokes avr-gcc from the installed `arduino:avr`
  // core (no system-wide avr-gcc needed).
  toolchain: {
    type: 'arduino-cli',
  },

  // Console polyfill configuration — `Serial.begin(9600)` is injected at the
  // top of `setup()` so `console.log` reaches the serial monitor.
  console: {
    baudRate: 9600,
  },
};

export default config;
