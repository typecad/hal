// ---------------------------------------------------------------------------
// @typecode/core — Project configuration types
//
// A `typecode.config.ts` file lives at the root of a user project and tells
// the transpiler which board, architecture, and build options to use.
// ---------------------------------------------------------------------------

import type { ArchitectureIdentifier } from './board/types';

// ---------------------------------------------------------------------------
// Output framework
// ---------------------------------------------------------------------------

/** Build-system / framework the transpiler should target. */
export type OutputFramework = 'arduino' | 'platformio' | 'esp-idf' | 'bare-metal';

/** Optimization strategy. */
export type OptimizationLevel = 'none' | 'size' | 'speed' | 'balanced';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/**
 * Output section — controls how generated C++ is laid out.
 */
export interface TypecodeOutputConfig {
  /** Target build framework. */
  framework: OutputFramework;
  /** Optimization level. */
  optimize?: OptimizationLevel;
  /** Directory to write generated files into (relative to project root). */
  outDir?: string;
  /** Additional compiler defines (KEY = value). */
  defines?: Record<string, string>;
  /** Extra compiler flags forwarded verbatim. */
  extraFlags?: string[];
}

/**
 * Root configuration object exported from `typecode.config.ts`.
 *
 * @example
 * ```ts
 * // typecode.config.ts
 * import type { TypecodeConfig } from './code/core';
 *
 * const config: TypecodeConfig = {
 *   target: 'avr',
 *   board: '@typecode/board-arduino-uno',
 *   output: {
 *     framework: 'arduino',
 *     optimize: 'size',
 *   },
 * };
 *
 * export default config;
 * ```
 */
export interface TypecodeConfig {
  /** Target architecture identifier (e.g. 'avr', 'esp32', 'rp2040'). */
  target: ArchitectureIdentifier;

  /**
   * Board package to use.  Can be:
   *   - a bare identifier  `'@typecode/board-arduino-uno'`
   *   - a relative path     `'./boards/my-custom-board'`
   */
  board: string;

  /**
   * Optional architecture shim override.
   * Defaults to the canonical shim for `target` (e.g. `@typecode/arch-avr`).
   */
  architecture?: string;

  /** Output / build options. */
  output?: TypecodeOutputConfig;

  /**
   * Fully-Qualified Board Name used by the Arduino CLI (e.g.
   * `arduino:avr:uno`).  Overrides whatever the board package declares.
   */
  fqbn?: string;

  /** Extra project-level TypeScript paths the transpiler should include. */
  include?: string[];

  /** Glob patterns to exclude from transpilation. */
  exclude?: string[];

  /**
   * Hardware test runner configuration (`@typecode/expect`).
   * Defines how `typecode-test` discovers files and communicates with the board.
   */
  test?: TypecodeTestConfig;

  /**
   * Toolchain configuration for compile/upload operations.
   * Controls which backend (arduino-cli or platformio) is used.
   */
  toolchain?: TypecodeToolchainConfig;

  /**
   * Console polyfill configuration for Arduino.
   * Controls Serial.begin() injection and default baud rate.
   */
  console?: TypecodeConsoleConfig;
}

// ---------------------------------------------------------------------------
// Toolchain configuration
// ---------------------------------------------------------------------------

/** Supported toolchain types for compile/upload operations. */
export type ToolchainType = 'arduino-cli' | 'platformio';

/** Arduino CLI specific configuration options. */
export interface ArduinoCliOptions {
  /** Path to arduino-cli executable. Auto-detected if not specified. */
  path?: string;
  /** Path to custom arduino-cli.yaml config file. */
  configFile?: string;
  /** Enable verbose output during compile/upload. */
  verbose?: boolean;
}

/** PlatformIO specific configuration options. */
export interface PlatformioOptions {
  /** Path to pio executable. Auto-detected if not specified. */
  path?: string;
  /** Target environment name from platformio.ini. */
  env?: string;
}

/**
 * Toolchain configuration for compile and upload operations.
 * Controls which backend (arduino-cli or platformio) is used.
 */
export interface TypecodeToolchainConfig {
  /** Toolchain type: 'arduino-cli' or 'platformio'. Default: 'arduino-cli' */
  type?: ToolchainType;
  /** Arduino CLI specific options. */
  arduinoCli?: ArduinoCliOptions;
  /** PlatformIO specific options. */
  platformio?: PlatformioOptions;
}

/**
 * Console polyfill configuration for Arduino.
 * Controls Serial.begin() injection and default baud rate.
 */
export interface TypecodeConsoleConfig {
  /** Default baud rate for Serial.begin() when auto-injected. Default: 9600 */
  baudRate?: number;
}

// ---------------------------------------------------------------------------
// Test configuration (@typecode/expect)
// ---------------------------------------------------------------------------

/**
 * Configuration for the `typecode-test` hardware test runner.
 * Add this section to your `typecode.config.ts` when using `@typecode/expect`.
 *
 * @example
 * ```ts
 * const config: TypecodeConfig = {
 *   board: '@typecode/board-arduino-uno',
 *   fqbn: 'arduino:avr:uno',
 *   test: {
 *     port: 'COM4',
 *     include: ['tests/hardware/**\/*.test.ts'],
 *   },
 * };
 * ```
 */
export interface TypecodeTestConfig {
  /** Glob patterns for hardware test files. Default: `['tests/**\/*.test.ts']`. */
  include?: string[];

  /** Serial port the board is connected to (e.g. `'COM4'`, `'/dev/ttyACM0'`). */
  port?: string;

  /** Serial baud rate for the test protocol. Default: `115200`. */
  baudRate?: number;

  /** Timeout in ms to wait for `[TC:SUITE_END]` from firmware. Default: `30000`. */
  timeout?: number;

  /** FQBN override — defaults to the root `fqbn` field. */
  fqbn?: string;

  /** Board package override — defaults to the root `board` field. */
  board?: string;
}
