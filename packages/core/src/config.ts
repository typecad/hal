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
type OutputFramework = string & {};

/** Optimization strategy. */
type OptimizationLevel = 'none' | 'size' | 'speed' | 'balanced';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

/**
 * Output section — controls how generated C++ is laid out.
 */
interface TypehalOutputConfig {
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
   *   - '@typehal/framework-arduino' - Arduino framework
   *   - '@typehal/framework-avr' - Native AVR registers
   *   - a relative path to a custom framework package
   * Must be specified explicitly; no default.
   */
  framework?: string;

  /** Output / build options. */
  output?: TypehalOutputConfig;

  /**
   * Framework-specific data.
   * Can contain properties like `buildTarget` that the framework toolchain uses.
   */
  frameworkData?: Record<string, unknown>;

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
   */
  toolchain?: TypehalToolchainConfig;

  /**
   * Console output configuration for the target framework.
   * Controls serial output initialization and default baud rate.
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
type ToolchainType = string;

/**
 * Toolchain configuration for compile and upload operations.
 */
interface TypehalToolchainConfig {
  /** Toolchain type identifier. Each framework defines its own valid values. */
  type?: ToolchainType;
  /** Framework-specific toolchain options. Each framework reads its own key. */
  frameworkOptions?: Record<string, unknown>;
}

/**
 * Console output configuration for the target framework.
 */
interface TypehalConsoleConfig {
  /** Default baud rate for console output when auto-injected. Default: 9600 */
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
 *   frameworkData: { buildTarget: 'arduino:avr:uno' },
 *   test: {
 *     port: 'COM4',
 *     include: ['tests/hardware/**\\/*.test.ts'],
 *   },
 * };
 * ```
 */
interface TypehalTestConfig {
  /** Glob patterns for hardware test files. Default: `['tests/**\\/*.test.ts']`. */
  include?: string[];

  /** Serial port the board is connected to (e.g. `'COM4'`, `'/dev/ttyACM0'`). */
  port?: string;

  /** Serial baud rate for the test protocol. Default: `115200`. */
  baudRate?: number;

  /** Timeout in ms to wait for `[TC:SUITE_END]` from firmware. Default: `30000`. */
  timeout?: number;

  /** Framework-specific build target override. */
  buildTarget?: string;

  /** Board package override — defaults to the root `board` field. */
  board?: string;
}
