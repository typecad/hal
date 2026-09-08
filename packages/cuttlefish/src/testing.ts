/**
 * Testing utilities for @typecad/cuttlefish.
 *
 * This module exposes internal transpiler functions that are needed by
 * the test suite but are intentionally kept out of the main public API
 * (`@typecad/cuttlefish`).  Import via `@typecad/cuttlefish/testing`.
 */

export { buildProgramIR } from "./ir/build-ir.js";
export { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter.js";
export { analyzePeripheralUsage, createEmptyPeripheralUsage } from "./ir/peripheral-usage.js";
export { inferSnprintfArg, createEmissionScopeState, escapeCppStringLiteral } from "./emit/snprintf-helpers.js";
export { setLoadedFramework } from "./framework-registry.js";
export { registerPlatformStrategy, resolveStrategy, clearAllProfileCaches } from "./platform/registry.js";
export type { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext } from "./types.js";

// ── AUTOSAR compliance module (test-visible) ───────────────────────────────
export { ComplianceContext, runSelfCheck, renderRegistryJson } from "./emit/compliance/index.js";
export type { ComplianceMode, SelfCheckFinding, Deviation } from "./emit/compliance/index.js";

// ── Config loader ───────────────────────────────────────────────────────────
export {
  findConfigFile,
  parseConfigFile,
  loadTypecadConfig,
  generateVirtualTypeDeclaration,
} from "./config-loader.js";

// ── Transpiler internal API ─────────────────────────────────────────────────
export { transpileFile } from "./transpile.js";

// ── UI bridge (optional @typecad/ui) ─────────────────────────────────────────
export { resetUIEngine, __simulateUIAbsentForTest } from "./ui/ui-bridge.js";

// ── Safety bridge (optional @typecad/safety) ────────────────────────────────
export { resetSafetyEngine, __simulateSafetyAbsentForTest } from "./safety/safety-bridge.js";
export { setSafetyHook, hasSafetyHook } from "./safety-hook.js";

// ── Project scaffolding ──────────────────────────────────────────────────────
export {
  scaffoldProject,
  normalizeProjectName,
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterProgram,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEslintConfig,
  runCreateWizard,
} from "./create/index.js";
export type { CreateProjectOptions } from "./create/index.js";

// ── Tree-shaking & reachability ──────────────────────────────────────────────
export { buildCallGraph, getReachableSymbols } from "./ir/call-graph.js";
export { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points.js";
export { analyzeReachability, getReachabilityStats } from "./ir/reachability.js";
export { filterProgramIR } from "./ir/filter.js";

// ── Validation ──────────────────────────────────────────────────────────────
export { validateTryCatch } from "./ir/try-catch-validation.js";
export { prescanUnsupportedFeatures } from "./ir/feature-prescan.js";
// Feature registry + ESLint selector source-of-truth (parity-tested).
export {
  LINT_RULES,
  ESLINT_OPT_OUT_KINDS,
  kindRegistryEntries,
} from "./ir/feature-registry.js";
export type { LintRule, FeatureEntry, FeatureStatus, DiagnosticMatch } from "./ir/feature-registry.js";

// ── ESLint gate ──────────────────────────────────────────────────────────────
export { runEslintCheck } from "./eslint-check.js";
export type { ESLintError } from "./eslint-check.js";

// ── ESLint gate cache ────────────────────────────────────────────────────────
export {
  checkLintCache,
  recordLintSuccess,
  invalidateLint,
  computeLintFingerprint,
  resolveEslintConfigPath,
} from "./lint-cache.js";
export type { LintFingerprint, GateCacheResult } from "./lint-cache.js";

// ── Semantic gates (TypeChecker-based) ──────────────────────────────────────
export { runSemanticGates } from "./orchestrator/type-checker.js";

// ── Board constants / pin capability internals ──────────────────────────────
export { readGeneratedBoardConstants } from "./ir/board-resolver.js";
export { pinEntryIndexForNumber } from "./ir/pin-capability-validation.js";

export {
  canonicalize,
  buildSemanticFacts,
} from "./orchestrator/semantic-facts.js";
export type {
  CanonicalType,
  SemanticFacts,
  FactStore,
  ValueCategory,
  Lifetime,
  Nullable,
  SemanticOrigin,
  AnalysisResult,
  BindingResolver,
} from "./orchestrator/semantic-facts.js";
export { verifyFacts } from "./orchestrator/semantic-facts-verifier.js";
export type { VerifierOptions, VerifierResult, UnknownTypeSeverity } from "./orchestrator/semantic-facts-verifier.js";

// ── Watch & CLI utilities ───────────────────────────────────────────────────
export { discoverWatchDirs, isRelevantChange } from "./watch.js";
export { parseCommandLine } from "./utils/cli.js";
export { parseHeader, stripPreprocessorBlocks } from "./libdef/header-parser.js";
export { BaseClassResolver, buildClassIndex } from "./libdef/base-class-resolver.js";
export type { ResolveResult } from "./libdef/base-class-resolver.js";
export { generateDecl, generateDeclsForDirectory } from "./libdef/cpp-to-decl.js";

// ── IR rendering internals (for fail-closed regression tests) ───────────────
export { renderExprAsText } from "./ir/render-expr.js";
export { contextStorage, CompilationContext } from "./ir/build-ir-state.js";
export type { ExpressionIR } from "./api/index.js";