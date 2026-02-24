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
}
