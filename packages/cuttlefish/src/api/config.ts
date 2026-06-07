// ---------------------------------------------------------------------------
// @typecad/hal — Project configuration types
//
// A `cuttlefish.config.ts` file lives at the root of a user project and tells
// the transpiler which board, architecture, and build options to use.
// ---------------------------------------------------------------------------

import type { ArchitectureIdentifier } from './board-types';

// ---------------------------------------------------------------------------
// Output section
// ---------------------------------------------------------------------------

/** Build-system / framework the transpiler should target. */
type OutputFramework = string & {};

/** Optimization strategy. */
type OptimizationLevel = 'none' | 'size' | 'speed' | 'balanced';

/**
 * Output section — controls how generated C++ is laid out.
 */
interface CuttlefishOutputConfig {
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
 * Root configuration object exported from `cuttlefish.config.ts`.
 */
export interface CuttlefishConfig {
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;

  /** Target architecture identifier (e.g. 'avr', 'esp32', 'rp2040'). */
  target: ArchitectureIdentifier;

  /**
   * MCU package providing silicon definitions.
   * Example: '@typecad/mcu-atmega328p'
   */
  mcu: string;
  
  /**
   * Board package to use. (Deprecated — use mcu + contract instead)
   */
  board?: string;

  /**
   * Path to a TypeCAD contract file (*.contract.json).
   * If provided, the transpiler will generate a narrowed board definition.
   */
  contract?: string;

  /**
   * Framework package for code generation strategy.
   */
  framework?: string;

  /** Output / build options. */
  output?: CuttlefishOutputConfig;

  /**
   * Framework-specific data.
   */
  frameworkData?: Record<string, unknown>;

  /** Extra project-level TypeScript paths the transpiler should include. */
  include?: string[];

  /** Glob patterns to exclude from transpilation. */
  exclude?: string[];

  /**
   * Hardware test runner configuration.
   */
  test?: CuttlefishTestConfig;

  /**
   * Toolchain configuration for compile/upload operations.
   */
  toolchain?: CuttlefishToolchainConfig;

  /**
   * Console output configuration.
   */
  console?: CuttlefishConsoleConfig;

  /**
   * Framework-specific configuration.
   */
  native?: Record<string, unknown>;
}

/**
 * Toolchain configuration for compile and upload operations.
 */
interface CuttlefishToolchainConfig {
  /** Toolchain type identifier. Each framework defines its own valid values. */
  type?: string;
  /** Framework-specific toolchain options. Each framework reads its own key. */
  frameworkOptions?: Record<string, unknown>;
}

/**
 * Console output configuration for the target framework.
 */
interface CuttlefishConsoleConfig {
  /** Default baud rate for console output when auto-injected. Default: 9600 */
  baudRate?: number;
}

/**
 * Configuration for the `cuttlefish-test` hardware test runner.
 */
interface CuttlefishTestConfig {
  /** Glob patterns for hardware test files. */
  include?: string[];

  /** Serial port the board is connected to (e.g. 'COM4', '/dev/ttyACM0'). */
  port?: string;

  /** Serial baud rate for the test protocol. Default: 115200. */
  baudRate?: number;

  /** Timeout in ms to wait for test completion. Default: 30000. */
  timeout?: number;

  /** Framework-specific build target override. */
  buildTarget?: string;

  /** Board package override — defaults to the root `board` field. */
  board?: string;
}
