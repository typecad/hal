// ---------------------------------------------------------------------------
// Framework Registry
//
// Holds the dynamically loaded framework package components so that CLI
// modules can access framework-specific strategy and toolchain without
// static import coupling.
//
// Replaces the former FrameworkApi singleton (CP5 decoupling). After moving
// polyfills, snprintf, and debug codegen into the CLI (CP1-CP3), the only
// remaining framework services are the strategy and toolchain.
//
// The registry is populated once per transpilation and cleared between runs.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "./api/shared/index.js";
import type { CompileResult, UploadResult, ToolchainOptions } from "./api/shared/index.js";

/**
 * Components loaded from a framework package.
 */
export interface LoadedFramework {
  /** The platform strategy (e.g. ZephyrStrategy, NativeStrategy) */
  strategy: PlatformStrategy;

  /** Optional toolchain for compile/upload/monitor (framework-specific) */
  toolchain?: FrameworkToolchain;

  /** Framework library import resolution (e.g., framework library detection) */
  libraryResolver?: FrameworkLibraryResolver;

  /** Framework class name mapping for library imports */
  classNameMapBuilder?: (imports: any[]) => Map<string, string>;

  /** Framework library .d.ts declaration generation */
  libDeclGenerator?: (modulePath: string, file: string) => string | undefined;

  /**
   * Optional subcommand presenters owned by the framework. Cuttlefish dispatches
   * `typecad-hal doctor` / `typecad-hal licenses` to these when the loaded
   * framework provides them; otherwise it prints a no-support message. Each
   * framework decides what (if anything) these do — e.g. framework-zephyr
   * checks west + board target (doctor) and scans library licenses
   * (licenses).
   */
  doctor?: () => void;
  licenses?: (strict: boolean, all: boolean) => void;
}

/**
 * Resolves framework-specific library imports.
 */
export interface FrameworkLibraryResolver {
  isFrameworkLibraryImport(moduleSpecifier: string): boolean;
  getFrameworkLibraryHeaderName(moduleSpecifier: string): string | undefined;
}

/**
 * Toolchain operations that a framework package may provide.
 * Uses a generic options bag so each framework reads what it needs
 * and ignores the rest.
 */
export interface FrameworkToolchain {
  prepare?(outputDir: string, entryPoint: string): void;
  compile(options: ToolchainOptions): CompileResult;
  upload?(options: ToolchainOptions): UploadResult;
  monitor?(options: ToolchainOptions): void;
  /**
   * Optional: start/stop the debug-owned gdb server for the last build
   * (e.g. `west debugserver`). The VS Code debug tasks drive this; the
   * F5 session connects to the server via cortex-debug's external mode.
   */
  debugServer?(options: ToolchainOptions, action: "start" | "stop"): void;
  /**
   * Optional: launch an interactive debugger session for the last build
   * (e.g. `west debug`). Not invoked by the standard build/compile flow;
   * powers an explicit debug-attach entry point. Frameworks that support
   * source-level debugging implement this to spawn their native debugger.
   */
  debug?(options: ToolchainOptions): void;
}

// ── Singleton state ────────────────────────────────────────────────────────

let _framework: LoadedFramework | undefined;

export function setLoadedFramework(framework: LoadedFramework): void {
  _framework = framework;
}

export function getLoadedFramework(): LoadedFramework {
  if (!_framework) {
    throw new Error(
      "Framework not loaded. Ensure a framework package is loaded before transpilation."
    );
  }
  return _framework;
}

export function hasLoadedFramework(): boolean {
  return _framework !== undefined;
}

export function clearLoadedFramework(): void {
  _framework = undefined;
}
