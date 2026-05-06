/**
 * Testing utilities for @typehal/transpiler.
 *
 * This module exposes internal transpiler functions that are needed by
 * the test suite but are intentionally kept out of the main public API
 * (`@typehal/transpiler`).  Import via `@typehal/transpiler/testing`.
 */

export { buildProgramIR } from "./ir/build-ir";
export { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter";
export { analyzePeripheralUsage, createEmptyPeripheralUsage } from "./ir/peripheral-usage";
export { inferSnprintfArg, createEmissionScopeState } from "./emit/snprintf-helpers";
export { setLoadedFramework } from "./framework-registry";
export { registerPlatformStrategy, resolveStrategy, clearAllProfileCaches } from "./platform/registry";
export type { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext } from "./types";

// ── Config loader ───────────────────────────────────────────────────────────
export {
  findConfigFile,
  parseConfigFile,
  loadTypehalConfig,
  generateVirtualTypeDeclaration,
} from "./config-loader";

// ── Scaffold / init ─────────────────────────────────────────────────────────
export {
  scaffoldProject,
  normalizeProjectName,
  KNOWN_BOARDS,
} from "./scaffold/init-scaffold";
export {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
} from "./scaffold/init-templates";
export type { InitProjectOptions } from "./scaffold/init-templates";

// ── Transpiler internal API ─────────────────────────────────────────────────
export { transpileFile } from "./transpile";

// ── Tree-shaking & reachability ──────────────────────────────────────────────
export { buildCallGraph, getReachableSymbols } from "./ir/call-graph";
export { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points";
export { analyzeReachability, getReachabilityStats } from "./ir/reachability";
export { filterProgramIR } from "./ir/filter";

// ── Validation ──────────────────────────────────────────────────────────────
export { validateTryCatch } from "./ir/try-catch-validation";

// ── Watch & CLI utilities ───────────────────────────────────────────────────
export { discoverWatchDirs, isRelevantChange } from "./watch";
export { parseCommandLine } from "./utils/cli";