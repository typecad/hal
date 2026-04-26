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
import type { CompileResult, UploadResult, ToolchainOptions } from "@typecode/core/shared";

/**
 * Components loaded from a framework package.
 */
export interface LoadedFramework {
  /** The platform strategy (e.g. ArduinoStrategy, NativeAVRStrategy) */
  strategy: PlatformStrategy;

  /** Optional toolchain for compile/upload/monitor (framework-specific) */
  toolchain?: FrameworkToolchain;

  /** Optional library resolver for Arduino-style library discovery */
  libraryResolver?: FrameworkLibraryResolver;
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

/**
 * Library resolution operations that a framework package may provide.
 */
export interface FrameworkLibraryResolver {
  isLibraryImport(moduleSpecifier: string): boolean;
  getLibraryHeaderName(moduleSpecifier: string): string | undefined;
  tryGenerateLibDecl(moduleSpecifier: string, fromFile: string): string | undefined;
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
