// ---------------------------------------------------------------------------
// Framework API Registry
//
// Holds the dynamically loaded framework package module so that CLI modules
// (polyfill generators, emitters, libdef resolution, etc.) can access
// framework-specific functions without a static import dependency.
//
// The registry is populated once per transpilation in transpileFile() and
// cleared between runs.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from "./ir/model";

/**
 * Shape of a framework package's public API.
 * Covers everything the CLI currently imports from @typecode/framework-arduino.
 */
export interface FrameworkApi {
  // ── Strategy ────────────────────────────────────────────────────────────
  FrameworkStrategy: new (...args: any[]) => any;

  // ── Expression / property-chain analysis ─────────────────────────────────
  extractPropertyChain(expr: ExpressionIR): string[] | undefined;

  // ── Class-name mapping for library imports ───────────────────────────────
  buildArduinoClassNameMap(imports: Array<{ moduleSpecifier: string; namedImports: string[] }>): Map<string, string>;

  // ── Library resolution ───────────────────────────────────────────────────
  isArduinoLibraryImport(moduleSpecifier: string): boolean;
  getArduinoLibraryHeaderName(moduleSpecifier: string): string | undefined;
  tryGenerateArduinoLibDecl(moduleSpecifier: string, fromFile: string): string | undefined;

  // ── Polyfill generators ──────────────────────────────────────────────────
  generateArduinoConsolePolyfill: (...args: any[]) => any;
  generateGenericConsolePolyfill: (...args: any[]) => any;
  generateStdVectorArrayPolyfill: (...args: any[]) => any;
  generateStaticArrayPolyfill: (...args: any[]) => any;
  generateStdStringPolyfill: (...args: any[]) => any;
  generateStaticStringPolyfill: (...args: any[]) => any;
  arduinoAsyncPolyfill: any;

  // ── Snprintf helpers ────────────────────────────────────────────────────
  createEmissionScopeState: (...args: any[]) => any;
  cloneEmissionScopeState: (...args: any[]) => any;
  createChildEmissionScope: (...args: any[]) => any;
  recordVariableType: (...args: any[]) => any;
  inferSnprintfArg: (...args: any[]) => any;
  buildSnprintfRenderResult: (...args: any[]) => any;
  shouldUseSnprintfForArduinoString: (...args: any[]) => any;
  statementNeedsSnprintf: (...args: any[]) => any;

  // ── Toolchain: compile / upload / monitor ───────────────────────────────
  flattenGeneratedModulesIntoSketch: (...args: any[]) => any;
  compileArduinoSketch: (...args: any[]) => any;
  uploadArduinoSketch: (...args: any[]) => any;
  monitorArduinoSketch: (...args: any[]) => any;
}

let _api: FrameworkApi | undefined;

export function setFrameworkApi(api: FrameworkApi): void {
  _api = api;
}

export function getFrameworkApi(): FrameworkApi {
  if (!_api) {
    throw new Error(
      "Framework API not initialized. Ensure the framework package is loaded before transpilation."
    );
  }
  return _api;
}

export function hasFrameworkApi(): boolean {
  return _api !== undefined;
}

export function clearFrameworkApi(): void {
  _api = undefined;
}
