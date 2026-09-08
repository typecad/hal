// ---------------------------------------------------------------------------
// @typecad/hal — Project configuration types
//
// A `typecad-hal.config.ts` file lives at the root of a user project and tells
// the transpiler which board, architecture, and build options to use.
// ---------------------------------------------------------------------------

import type { ArchitectureIdentifier } from './board-types.js';
import type { DisplayConfig } from './shared/display-profile.js';

// ---------------------------------------------------------------------------
// Output section
// ---------------------------------------------------------------------------

/** Build-system / framework the transpiler should target. */
type OutputFramework = string & {};

/**
 * Output section — controls how generated C++ is laid out.
 */
interface CuttlefishOutputConfig {
  /**
   * Target build framework. Optional — the top-level `framework` field is the
   * primary source; this mirrors it for the output section and is rarely set.
   * Matches the optional Zod `output.framework` in config-schema.ts.
   */
  framework?: OutputFramework;
  /** Directory to write generated files into (relative to project root). */
  outDir?: string;
  /** Additional compiler defines (KEY = value). */
  defines?: Record<string, string>;
  /** Extra compiler flags forwarded verbatim. */
  extraFlags?: string[];
}

/**
 * Zephyr-specific configuration.
 *
 * When `framework` is `'@typecad/framework-zephyr'`, this section controls
 * Kconfig symbols merged into prj.conf, extra CMake arguments forwarded to
 * `west build`, and the flash runner override.
 */
export interface CuttlefishZephyrConfig {
  /**
   * Additional Kconfig symbols merged into the generated prj.conf.
   *
   * Example:
   *   kconfig: { CONFIG_ESP32_USE_UNSUPPORTED_REVISION: 'y' }
   */
  kconfig?: Record<string, string>;
  /** Extra arguments forwarded to `west build`. */
  cmakeArgs?: string[];
  /**
   * Named probe method from the board's supported table (e.g. 'stlink',
   * 'dfu', 'jlink') — what `--probe` on the CLI also accepts. Serves both
   * flashing and debugging; resolves to a west runner plus the args the
   * method needs. The board package is the source of the table. Mutually
   * exclusive with `runner`.
   */
  probe?: string;
  /** Override the west flash runner (e.g. 'nrfjprog', 'jlink', 'openocd'). */
  runner?: string;
  /**
   * Extra arguments appended verbatim to `west flash` after the runner —
   * anything the chosen runner's parser accepts. Example for an ST-Link
   * clone with no SRST line wired to the target:
   *   runnerArgs: ['--cmd-pre-init=reset_config none']
   */
  runnerArgs?: string[];
}

/**
 * Root configuration object exported from `typecad-hal.config.ts`.
 */
export interface TypecadConfig {
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;

  /** Target architecture identifier (e.g. 'avr', 'esp32', 'rp2040'). */
  target: ArchitectureIdentifier;

  /**
   * Zephyr board target — the qualified `west build -b` argument (e.g.
   * 'esp32s3_devkitc/esp32s3/procpu'). The project-local board module
   * (.typecad-hal/board.ts + board.json) is a derived artifact: every build
   * regenerates it when any input moves — this field, the local board
   * catalog, or the Zephyr tree the catalog was generated from. The catalog
   * itself is always local (`typecad-hal board sync` rebuilds it from your
   * tree); there is no compiled-in board database.
   */
  board?: string;

  /**
   * Zephyr SoC name for contract-based projects (custom PCBs with no board
   * target) — e.g. 'stm32f411xe'. Selects the curated soc descriptor whose
   * pin set the contract narrows against. Required with `contract` on
   * embedded targets.
   */
  soc?: string;

  /**
   * Path to a TypeCAD contract file (*.contract.json).
   * If provided, the transpiler will generate a narrowed board definition.
   */
  contract?: string;

  /**
   * Framework package for code generation strategy.
   */
  framework?: string;

  /**
   * ESP32 PSRAM type. When set, the framework emits the PSRAM-enabling
   * Kconfig + BOARD_HAS_PSRAM define (Zephyr) so large canvas
   * allocations (scroll viewports, lists) prefer external RAM. No effect
   * on boards without PSRAM.
   */
  psram?: 'opi' | 'quad';

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
   * Framework-specific configuration.
   */
  native?: Record<string, unknown>;

  /**
   * Display configuration — references a built-in profile by name and/or
   * specifies display wiring (cs, dc, rst) and overrides.
   *
   * display: { profile: 'ili9341-spi', cs: 5, dc: 21, rst: 22 }
   */
  display?: DisplayConfig;

  /**
   * Zephyr-specific configuration. Only used when the framework is
   * '@typecad/framework-zephyr'.
   */
  zephyr?: CuttlefishZephyrConfig;
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
 * Configuration for the `typecad-hal test` hardware test runner.
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
