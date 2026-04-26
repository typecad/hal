// ---------------------------------------------------------------------------
// Framework API Registry — DEPRECATED
//
// This module has been replaced by framework-registry.ts (CP5 decoupling).
// After moving polyfills, snprintf, and debug codegen into the CLI (CP1-CP3),
// the FrameworkApi singleton had no remaining callers.
//
// Kept as a thin re-export shim for any lingering references during migration.
// New code should use framework-registry.ts directly.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "./platform/platform-strategy";
import type { ExpressionIR } from "./ir/model";

/**
 * @deprecated Use LoadedFramework from framework-registry.ts instead.
 */
export interface FrameworkApi {
  FrameworkStrategy: new (...args: any[]) => any;
  extractPropertyChain(expr: ExpressionIR): string[] | undefined;
  buildArduinoClassNameMap(imports: Array<{ moduleSpecifier: string; namedImports: string[] }>): Map<string, string>;
  isArduinoLibraryImport(moduleSpecifier: string): boolean;
  getArduinoLibraryHeaderName(moduleSpecifier: string): string | undefined;
  tryGenerateArduinoLibDecl(moduleSpecifier: string, fromFile: string): string | undefined;
  flattenGeneratedModulesIntoSketch: (...args: any[]) => any;
  compileArduinoSketch: (...args: any[]) => any;
  uploadArduinoSketch: (...args: any[]) => any;
  monitorArduinoSketch: (...args: any[]) => any;
}

/** @deprecated Use setLoadedFramework() from framework-registry.ts */
export function setFrameworkApi(_api: FrameworkApi): void {
  // No-op — registry is now populated by framework-package.ts
}

/** @deprecated Use getLoadedFramework() from framework-registry.ts */
export function getFrameworkApi(): FrameworkApi {
  throw new Error(
    "FrameworkApi is deprecated. Use getLoadedFramework() from framework-registry.ts instead."
  );
}

/** @deprecated Use hasLoadedFramework() from framework-registry.ts */
export function hasFrameworkApi(): boolean {
  return false;
}

/** @deprecated Use clearLoadedFramework() from framework-registry.ts */
export function clearFrameworkApi(): void {
  // No-op — registry clearing is handled by framework-registry.ts
}
