// ---------------------------------------------------------------------------
// @typehal/core — Project configuration types
//
// A `typehal.config.ts` file lives at the root of a user project and tells
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
export interface TypehalOutputConfig {
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
 * Root configuration object exported from `typehal.config.ts`.
 *
 * @example
 * ```ts
 * // typehal.config.ts
 * import type { TypehalConfig } from './code/core';
 *
 * const config: TypehalConfig = {
 *   target: 'avr',
 *   board: '@typehal/board-arduino-uno',
 *   output: {
 *     framework: 'arduino',
 *     optimize: 'size',
 *   },
 * };
 *
 * export default config;
 * ```
 */
export interface TypehalConfig {
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;

  /** Target architecture identifier (e.g. 'avr', 'esp32', 'rp2040'). */
  target: ArchitectureIdentifier;

  /**
   * Board package to use.  Can be:
   *   - a bare identifier  `'@typehal/board-arduino-uno'`
   *   - a relative path     `'./boards/my-custom-board'`
   */
  board: string;

  /**
   * Framework package for code generation strategy.
   * Can be:
   *   - '@typehal/framework-arduino' - Arduino framework (digitalWrite, etc.)
   *   - '@typehal/framework-avr' - Native AVR registers (PORTB, etc.)
   *   - a relative path to a custom framework package
   * Defaults to '@typehal/framework-arduino' if not specified.
   */
  framework?: string;

  /** Output / build options. */
  output?: TypehalOutputConfig;

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
   * Hardware test runner configuration (`@typehal/expect`).
   * Defines how `typehal-test` discovers files and communicates with the board.
   */
  test?: TypehalTestConfig;

  /**
   * Toolchain configuration for compile/upload operations.
   * Uses arduino-cli as the backend.
   */
  toolchain?: TypehalToolchainConfig;

  /**
   * Console polyfill configuration for Arduino.
   * Controls Serial.begin() injection and default baud rate.
   */
  console?: TypehalConsoleConfig;

  /**
   * Framework-specific configuration. Each framework reads its own section.
   * For native C++ builds, use the `NativeCompileConfig` shape from
   * `@typehal/framework-native`.
   */
  native?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Toolchain configuration
// ---------------------------------------------------------------------------

/** Supported toolchain types for compile/upload operations. */
export type ToolchainType = 'arduino-cli';

/** Arduino CLI specific configuration options. */
export interface ArduinoCliOptions {
  /** Path to arduino-cli executable. Auto-detected if not specified. */
  path?: string;
  /** Path to custom arduino-cli.yaml config file. */
  configFile?: string;
  /** Enable verbose output during compile/upload. */
  verbose?: boolean;
}

/**
 * Toolchain configuration for compile and upload operations.
 * Uses arduino-cli as the backend.
 */
export interface TypehalToolchainConfig {
  /** Toolchain type: 'arduino-cli'. Default: 'arduino-cli' */
  type?: ToolchainType;
  /** Arduino CLI specific options. */
  arduinoCli?: ArduinoCliOptions;
}

/**
 * Console polyfill configuration for Arduino.
 * Controls Serial.begin() injection and default baud rate.
 */
export interface TypehalConsoleConfig {
  /** Default baud rate for Serial.begin() when auto-injected. Default: 9600 */
  baudRate?: number;
}

// ---------------------------------------------------------------------------
// Test configuration (@typehal/expect)
// ---------------------------------------------------------------------------

/**
 * Configuration for the `typehal-test` hardware test runner.
 * Add this section to your `typehal.config.ts` when using `@typehal/expect`.
 *
 * @example
 * ```ts
 * const config: TypehalConfig = {
 *   board: '@typehal/board-arduino-uno',
 *   fqbn: 'arduino:avr:uno',
 *   test: {
 *     port: 'COM4',
 *     include: ['tests/hardware/**\/*.test.ts'],
 *   },
 * };
 * ```
 */
export interface TypehalTestConfig {
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
