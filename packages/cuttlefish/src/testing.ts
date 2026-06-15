/**
 * Testing utilities for @typecad/cuttlefish.
 *
 * This module exposes internal transpiler functions that are needed by
 * the test suite but are intentionally kept out of the main public API
 * (`@typecad/cuttlefish`).  Import via `@typecad/cuttlefish/testing`.
 */

export { buildProgramIR } from "./ir/build-ir";
export { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter";
export { analyzePeripheralUsage, createEmptyPeripheralUsage } from "./ir/peripheral-usage";
export { inferSnprintfArg, createEmissionScopeState, escapeCppStringLiteral } from "./emit/snprintf-helpers";
export { setLoadedFramework } from "./framework-registry";
export { registerPlatformStrategy, resolveStrategy, clearAllProfileCaches } from "./platform/registry";
export type { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext } from "./types";

// ── Config loader ───────────────────────────────────────────────────────────
export {
  findConfigFile,
  parseConfigFile,
  loadCuttlefishConfig,
  generateVirtualTypeDeclaration,
} from "./config-loader";

// ── Transpiler internal API ─────────────────────────────────────────────────
export { transpileFile } from "./transpile";

// ── Project scaffolding ──────────────────────────────────────────────────────
export {
  scaffoldProject,
  normalizeProjectName,
  KNOWN_BOARDS,
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
  generateEslintConfig,
  runInitWizard,
} from "./create";
export type { InitProjectOptions } from "./create";

// ── Tree-shaking & reachability ──────────────────────────────────────────────
export { buildCallGraph, getReachableSymbols } from "./ir/call-graph";
export { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points";
export { analyzeReachability, getReachabilityStats } from "./ir/reachability";
export { filterProgramIR } from "./ir/filter";

// ── Validation ──────────────────────────────────────────────────────────────
export { validateTryCatch } from "./ir/try-catch-validation";
export { prescanUnsupportedFeatures } from "./ir/feature-prescan";

// ── ESLint gate ──────────────────────────────────────────────────────────────
export { runEslintCheck } from "./eslint-check";
export type { ESLintError } from "./eslint-check";

// ── Semantic gates (TypeChecker-based) ──────────────────────────────────────
export { runSemanticGates } from "./orchestrator/type-checker";

// ── Watch & CLI utilities ───────────────────────────────────────────────────
export { discoverWatchDirs, isRelevantChange } from "./watch";
export { parseCommandLine } from "./utils/cli";