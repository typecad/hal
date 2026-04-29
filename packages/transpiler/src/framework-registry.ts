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

import type { PlatformStrategy } from "./platform/platform-strategy";
import type { CompileResult, UploadResult, ToolchainOptions } from "@typehal/core/shared";

/**
 * Components loaded from a framework package.
 */
export interface LoadedFramework {
  /** The platform strategy (e.g. ArduinoStrategy, NativeAVRStrategy) */
  strategy: PlatformStrategy;

  /** Optional toolchain for compile/upload/monitor (framework-specific) */
  toolchain?: FrameworkToolchain;

  /** Framework library import resolution (e.g., Arduino library detection) */
  libraryResolver?: FrameworkLibraryResolver;

  /** Framework class name mapping for library imports */
  classNameMapBuilder?: FrameworkClassNameMapBuilder;

  /** Framework library .d.ts declaration generation */
  libDeclGenerator?: FrameworkLibDeclGenerator;
}

/**
 * Resolves framework-specific library imports (e.g., Arduino libraries).
 */
export interface FrameworkLibraryResolver {
  isFrameworkLibraryImport(moduleSpecifier: string): boolean;
  getFrameworkLibraryHeaderName(moduleSpecifier: string): string | undefined;
}

/**
 * Builds a mapping from short class names to fully qualified C++ names.
 */
export interface FrameworkClassNameMapBuilder {
  buildClassNameMap(imports: any[]): Map<string, string>;
}

/**
 * Generates .d.ts declarations from framework library headers.
 */
export interface FrameworkLibDeclGenerator {
  tryGenerateLibDecl(modulePath: string, file: string): string | undefined;
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
