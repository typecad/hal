
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Read once at module load. Used to populate the AUTOSAR deviation sidecar's
// `toolVersion` field. Falls back to "unknown" if the read fails (e.g. tests
// that import the module from an unexpected location).
const CUTTLEFISH_VERSION: string = (() => {
  try {
    const require_ = createRequire(import.meta.url);
    // transpile.ts lives in src/, compiled to dist/transpile.js. The package
    // root is one level up from dist/, so from dist/ the path is ../package.json.
    // From src/ (TypeScript source used by tests) it's also ../package.json.
    const pkg = require_("../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
import { buildProgramIR } from "./ir/build-ir.js";
import { getCurrentBoardConstants, resetTranspileResolvedHalOps } from "./ir/build-ir-state.js";
import { classDeclarationToIR } from "./ir/declaration-builders.js";
import { clickHandlers } from "./ir/transformers/ui-call-resolver.js";
import { setUIHook, requireUIHook, hasUIHook } from "./ui-hook.js";
import { loadUIEngine } from "./ui/ui-bridge.js";
import { hasSafetyHook, requireSafetyHook } from "./safety-hook.js";
import { loadSafetyEngine } from "./safety/safety-bridge.js";
import { isSafetyImportSpecifier } from "./safety/specifiers.js";
import { setDisplayProfile, resetDisplayProfile, getDisplayProfile } from "./stores/display-profile-store.js";
import { setThemeCss, resetThemeCss, setThemeClass } from "./stores/theme-store.js";
import { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter.js";
import { Diagnostic, GeneratedOutputs, TranspileOptions, TreeShakingOptions } from "./types.js";
import { readText, writeText, resetWrittenFiles, wasWrittenThisRun } from "./utils/fs.js";
import { debug as logDebug, info } from "./utils/logger.js";
import { printDebugStrategy } from "./utils/ui.js";
import { loadLibraryDefinitions } from "./libdef/registry.js";
import {
  resetCuttlefishLibraries,
  validateCuttlefishLibraries,
  cuttlefishLibraryLibdefs,
  libraryDefinitionKey,
  writeCuttlefishLibraryArtifacts,
} from "./library-packages.js";
import type { ClassIR, ProgramIR } from "./api/index.js";
import { buildCallGraph } from "./ir/call-graph.js";
import {
  clearCaches,
  getCachedNpmPackage,
  setCachedNpmPackage,
  getCachedPackageJson,
  setCachedPackageJson,
  getOrParseSourceFile,
  cachedFileExists,
  cachedIsFile,
  getOrReadFile,
} from "./cache.js";
import { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points.js";
import { analyzeReachability } from "./ir/reachability.js";
import { filterProgramIR } from "./ir/filter.js";
import { setActiveStrategy, loadHALModules, setHALProjectDir } from "./ir/hal-resolver.js";
import { preprocess as testRunnerPreprocess } from "./test-runner/preprocessor.js";
import { CompilationContext, contextStorage } from "./ir/build-ir-state.js";
import { buildSymbolTable, mergeSymbolTable, resolveInheritance, createSymbolTable } from "./ir/symbol-table.js";
import { loadBreakpoints, preprocess as debugPreprocess } from "./debug/index.js";
import { collectTranspileGraph } from "./orchestrator/graph-builder.js";
import { typeCheckFiles } from "./orchestrator/type-checker.js";
import { runSemanticGates } from "./orchestrator/type-checker.js";
import { autoGenerateMissingDecls } from "./orchestrator/dts-generator.js";
import { runEslintCheck, printEslintErrors } from "./eslint-check.js";
import { checkLintCache, recordLintSuccess } from "./lint-cache.js";
import { initProfiler, getProfiler } from "./profiler/index.js";
import { buildDiagnosticsReport, writeDiagnosticsReport } from "./diagnostics/diagnostics-report.js";
import {
  ResolvedNpmPackage,
  NativeCppModule,
  TranspileGraphResult,
  detectNativeCppModule,
  getNpmPackageInfoForFile,
  isInNodeModules,
  resolveImport,
  isCuttlefishSDKPath,
} from "./transpile/resolution.js";
type ExpectPreprocessor = (source: string, fileName?: string) => string;
const require = createRequire(import.meta.url);

function loadExpectPreprocessor(): ExpectPreprocessor {
  // The test DSL preprocessor is engine-internal (src/test-runner/) since the
  // expect package dissolved — nothing to resolve, never absent.
  return testRunnerPreprocess;
}

function cleanOutput(_entryDir: string, outDir: string): void {
  // The out dir is NOT wiped: writeText skips writing when content is
  // identical, so keeping it lets downstream build tools (idf.py/ninja,
  // west) reuse their build caches. Stale generated SOURCES are handled
  // precisely instead — after emission, sweepStaleGeneratedSources() removes
  // compiled-source files in the out dir that this run did not write (e.g. a
  // main.cpp left behind by the old emit naming next to the current src.cpp;
  // Zephyr's CMakeLists globs src/*.cpp, so a leftover compiles into
  // duplicate-symbol link errors). The output dir is still created (via
  // writeText → ensureDir) on first run.
  void outDir;
  resetWrittenFiles();
}

const GENERATED_SOURCE_EXTENSIONS = [".cpp", ".cc", ".c", ".h"];

/**
 * Remove stale generated source files from the out dir: compiled-source files
 * that THIS transpile run did not write. Sweeps only the source layouts the
 * emit pipeline uses (out dir root, src/, main/) and never recurses — build
 * trees (e.g. Zephyr's out/build with its own generated .c files) are
 * untouched, and neither are sidecar JSONs.
 */
function sweepStaleGeneratedSources(outDir: string): void {
  for (const sub of ["", "src", "main"]) {
    const dir = sub ? path.join(outDir, sub) : outDir;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // layout subdir not used by this framework
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!GENERATED_SOURCE_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
      const full = path.join(dir, entry.name);
      if (wasWrittenThisRun(full)) continue;
      try {
        fs.unlinkSync(full);
        info(`Removed stale generated source: ${path.relative(process.cwd(), full)}`);
      } catch {
        // Locked/read-only file — leave it; best-effort cleanup.
      }
    }
  }
}

  

/**
 * Auto-generates .d.ts files for C++ modules that are missing declarations.
 * Also tries to generate declarations for framework libraries.
 * Returns list of generated files.
 */


/**
 * True iff the program imports the safety authoring surface anywhere. The
 * safety transform pass uses this as its fast no-op guard — when no file
 * imports safety, the pass returns the program unchanged.
 */
function entryImportsSafety(program: ProgramIR): boolean {
  for (const imp of program.imports) {
    if (isSafetyImportSpecifier(imp.moduleSpecifier)) return true;
  }
  return false;
}

/**
 * Apply tree-shaking to program IR if enabled
 */
function applyTreeShaking(
  programIR: ProgramIR,
  target: TranspileOptions["target"],
  treeShakingOptions?: TreeShakingOptions
): { programIR: ProgramIR; removedSymbols: string[] } {
  // Default to enabled - tree-shaking removes unreachable code
  const enabled = treeShakingOptions?.enabled !== false;

  if (!enabled) {
    return { programIR, removedSymbols: [] };
  }

  const profiler = getProfiler();

  // Build call graph
  profiler.startTimer("tree-shake:call-graph");
  const callGraph = buildCallGraph(programIR);
  profiler.endTimer("tree-shake:call-graph");

  // Detect entry points
  profiler.startTimer("tree-shake:entry-points");
  const treeShakeStrategy = resolveStrategy(target);
  const entryPoints = detectEntryPoints(programIR, {
    customEntryPoints: treeShakingOptions?.entryPoints ?? [],
  }, treeShakeStrategy.requiresLoopFunction()
    ? [treeShakeStrategy.entrypointFunctionName(), "loop"]
    : [treeShakeStrategy.entrypointFunctionName()]);
  profiler.endTimer("tree-shake:entry-points");

  // Analyze reachability
  profiler.startTimer("tree-shake:reachability");
  const reachability = analyzeReachability(programIR, callGraph, {
    target,
    entryPointConfig: {
      customEntryPoints: treeShakingOptions?.entryPoints ?? [],
    },
    keepUnusedEnums: treeShakingOptions?.keepUnusedEnums,
    keepUnusedClasses: treeShakingOptions?.keepUnusedClasses,
    keepUnusedTypeAliases: treeShakingOptions?.keepUnusedTypeAliases,
    keepUnusedVariables: treeShakingOptions?.keepUnusedVariables,
    reportUnused: treeShakingOptions?.reportUnused,
  });
  profiler.endTimer("tree-shake:reachability");

  // Filter program IR
  profiler.startTimer("tree-shake:filter");
  const result = filterProgramIR(programIR, reachability, {
    enabled: true,
    keepUnusedEnums: treeShakingOptions?.keepUnusedEnums,
    keepUnusedClasses: treeShakingOptions?.keepUnusedClasses,
    keepUnusedTypeAliases: treeShakingOptions?.keepUnusedTypeAliases,
    keepUnusedVariables: treeShakingOptions?.keepUnusedVariables,
    reportUnused: treeShakingOptions?.reportUnused,
  });
  profiler.endTimer("tree-shake:filter");

  // Collect removed symbols for the report
  const removedSymbols: string[] = [];
  for (const fn of programIR.functions) {
    if (!reachability.reachableFunctions.has(fn.originalName)) removedSymbols.push(fn.originalName);
  }
  for (const cls of programIR.classes) {
    if (!reachability.reachableClasses.has(cls.name)) removedSymbols.push(cls.name);
  }
  for (const e of programIR.enums) {
    if (!reachability.reachableEnums.has(e.name)) removedSymbols.push(e.name);
  }

  return { programIR: result, removedSymbols };
}

import type { PlatformStrategy } from "./api/shared/index.js";
import { isStringEnum } from "./api/shared/index.js";
import { resolveStrategy } from "./platform/registry.js";
import { loadFrameworkPackage } from "./framework-package.js";
export { loadFrameworkPackage };
export { getLoadedFramework, hasLoadedFramework } from "./framework-registry.js";
import { getLoadedFramework, hasLoadedFramework } from "./framework-registry.js";

type LocatedDiagnostic = {
  filePath?: string;
  diagnostic: Diagnostic;
};

/** Under --strict-css, UI CSS-compatibility warnings (code css-*: ignored
 *  alpha, quantized font sizes, unsupported display/position values, ...) are
 *  upgraded to errors so the build fails instead of approximating silently. */
function upgradeStrictCss(d: Diagnostic, strict: boolean | undefined): Diagnostic {
  if (strict && d.severity === "warning" && typeof d.code === "string" && d.code.startsWith("css-")) {
    return { ...d, severity: "error" };
  }
  return d;
}

function formatFatalDiagnostics(entries: LocatedDiagnostic[]): string {
  const errors = entries.filter(({ diagnostic }) => diagnostic.severity === "error");
  const lines = [
    `Transpilation aborted because ${errors.length} unsupported pattern${errors.length === 1 ? "" : "s"} were found.`,
  ];

  for (const { filePath, diagnostic } of errors) {
    // Prefer diagnostic.filePath (set explicitly by the emitter, e.g. AUTOSAR
    // diagnostics that map a C++ line back to TS) over the wrapper's filePath
    // (the TS source file being processed, which may not be the right pointer
    // for emit-stage diagnostics).
    const resolvedFile = diagnostic.filePath ?? filePath;
    const locationBase = resolvedFile
      ? path.relative(process.cwd(), resolvedFile) || resolvedFile
      : diagnostic.source ?? "user code";
    const position = diagnostic.line != null
      ? `(${diagnostic.line}:${diagnostic.column ?? 1})`
      : "";
    const code = diagnostic.code ? `[${diagnostic.code}] ` : "";
    lines.push(`ERROR: ${locationBase}${position}: ${code}${diagnostic.message}`);

    if (diagnostic.sourceLine) {
      lines.push(`  ${diagnostic.sourceLine}`);
      if (diagnostic.column != null && diagnostic.column > 0) {
        lines.push(`  ${" ".repeat(Math.max(0, diagnostic.column - 1))}^`);
      }
    }

    if (diagnostic.hint) {
      lines.push(`  hint: ${diagnostic.hint}`);
    }
  }

  return lines.join("\n");
}

function throwIfFatalDiagnostics(entries: LocatedDiagnostic[]): void {
  if (entries.some(({ diagnostic }) => diagnostic.severity === "error")) {
    throw new Error(formatFatalDiagnostics(entries));
  }
}

/**
 * Load the platform strategy from the configured framework package.
 *
 * Uses the unified loading path (CP6): loads the framework package via
 * loadFrameworkPackage(), which populates the LoadedFramework registry,
 * then extracts the strategy.
 *
 * Returns undefined if no framework package is configured or the package
 * doesn't export a FrameworkStrategy, allowing emitCpp to fall back to
 * target-based resolution via the platform registry.
 */
function loadPlatformStrategy(
  frameworkPackage: string | undefined,
  _boardTarget: string | undefined,
  fromDir: string,
  debug?: boolean,
): PlatformStrategy | undefined {
  if (!frameworkPackage) {
    if (debug) {
      logDebug(`No framework package configured, will use target-based resolution`, true);
    }
    return undefined;
  }

  try {
    loadFrameworkPackage(frameworkPackage, fromDir);
    if (hasLoadedFramework()) {
      const { strategy } = getLoadedFramework();
      if (debug) {
        // Styled like the other step lines (cyan ⇉) — says what the debug
        // build is actually doing, in user terms. Falls back to the package
        // name when the strategy carries no id.
        const frameworkName = strategy.id || frameworkPackage.replace(/^@typecad\/framework-/, "");
        printDebugStrategy(frameworkName);
      }
      return strategy;
    }
  } catch (e) {
    if (debug) {
      logDebug(`Failed to load strategy from ${frameworkPackage}: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  if (debug) {
    logDebug(`No framework strategy loaded, will use target-based resolution`, true);
  }
  return undefined;
}

export async function transpileFile(options: TranspileOptions): Promise<GeneratedOutputs> {
  // Initialize profiler (disabled by default - internal use only)
  const profiler = initProfiler({
    enabled: options.diagnostics === true,
    trackMemory: false,
    threshold: 0, // Ensure even fast phases are recorded for the report
  });

  profiler.startSession();
  profiler.startTimer("setup:caches");

  // Clear session caches at the start of each transpilation
  clearCaches();

  // Load the UI engine from @typecad/ui (if installed). Sets up the hook so
  // requireUIHook() works throughout this transpile run. Gracefully no-ops
  // when @typecad/ui is absent (pure TS→C++ transpile).
  await loadUIEngine();

  // Load the safety engine from @typecad/safety (if installed). Sets up the
  // hook so requireSafetyHook() works throughout this transpile run.
  // Gracefully no-ops when @typecad/safety is absent.
  await loadSafetyEngine();

  const entryFile = path.resolve(options.inputFile);
  const entryDir = path.dirname(entryFile);
  const sourceDir = entryDir;
  const entryBaseName = path.basename(entryFile).replace(/\.[^.]+$/, "");
  const outBaseDir = options.outDir ?? sourceDir;

  // Anchor HAL source parsing to THIS project's @typecad/hal (falling back to
  // cwd / the monorepo sibling inside resolveHALSourceDir). Must run before
  // the loadHALModules warm-up below so the registry reflects the project's
  // hal copy, not whatever an earlier run in this process pinned.
  setHALProjectDir(options.projectRoot ?? entryDir);

  profiler.endTimer("setup:caches");

  profiler.startTimer("setup:load-strategy");
  // Load platform strategy from framework or board package, or use target-based resolution
  const boardStrategy = loadPlatformStrategy(
    options.frameworkPackage,
    options.boardTarget,
    entryDir,
    options.debug,
  );
  profiler.endTimer("setup:load-strategy");

  // Use the framework-loaded strategy for output path computation if available,
  // otherwise fall back to target-based resolution.  This ensures a single
  // consistent strategy drives both the output directory and emission.
  const strategy = boardStrategy ?? resolveStrategy(options.target);
  setActiveStrategy(strategy);

  // Load display profile from config (if present) into the profile store.
  resetDisplayProfile();
  resetThemeCss();
  const configDisplay = (options as any).display;
  if (configDisplay) {
    const { resolveDisplayProfile } = await import("./api/shared/display-profile.js");
    // Build the named-profile registry. Prefer the strategy's hook (per-framework
    // canonical profiles — the framework returns its BUILT_IN_PROFILES
    // its DT-binding profiles). Fall back to the legacy dynamic import of the
    // framework's displays/ili9341-spi module when the strategy provides none.
    // The registry maps a config `profile` name (e.g. "st7796-zephyr") to its
    // DisplayProfile; an empty registry makes resolveDisplayProfile fall back to
    // the bare default driver (config.driver ?? "ili9341") when no profile name
    // is set, or throw "Unknown display profile" when one is.
    let registry: Map<string, any> = new Map();
    if (strategy.getProfileRegistry) {
      registry = strategy.getProfileRegistry();
    } else if (options.frameworkPackage) {
      const profileMod = await import(options.frameworkPackage + "/displays/ili9341-spi").catch(() => null);
      if (profileMod?.BUILT_IN_PROFILES) {
        for (const [k, v] of Object.entries(profileMod.BUILT_IN_PROFILES)) {
          registry.set(k, v as any);
        }
      }
    }
    const resolved = resolveDisplayProfile(configDisplay, registry);
    const buildTarget = (options.platformContext?.frameworkData?.buildTarget as string | undefined);
    setDisplayProfile(resolved.profile, { cs: resolved.cs, dc: resolved.dc, rst: resolved.rst, bus: resolved.bus, address: resolved.address, reset: resolved.reset, buildTarget });
    // Apply theme CSS override if specified.
    if (configDisplay.themeCss) {
      setThemeCss(configDisplay.themeCss);
    }
    if (configDisplay.themeClass) {
      setThemeClass(configDisplay.themeClass);
    }
  }

  const outDir = path.join(outBaseDir, strategy.outputSubdirectory(entryBaseName));

  // Start fresh: clean the output directory. (Incremental builds are disabled —
  // see incremental-cache.ts — so we always transpile the full graph.)
  cleanOutput(entryDir, outDir);

  // The out dir is 100% generated output, whatever the user named it. The
  // scaffold's root .gitignore only covers the default name (`out/`), so a
  // renamed outDir would expose the whole tree — including the target's build
  // artifacts — to `git add .`. An ignore file INSIDE the dir follows it
  // wherever the config points it. With a dedicated outDir (config or flag)
  // the whole app root is generated; in in-source emit mode only the
  // strategy's subdir is (native .build/, zephyr src/) — never the user's
  // source files.
  const generatedRoot = options.outDir ? outBaseDir : outDir;
  writeText(
    path.join(generatedRoot, ".gitignore"),
    ["# Generated by typecad-hal on build — do not edit or commit.", "*", "!.gitignore", ""].join("\n"),
  );

  profiler.startTimer("graph:collect");
  // Image-conversion cap: never decode larger than the physical panel —
  // converted <img> assets downscale to fit (no 24MB C arrays from photos).
  const imageDecodeMax = await (async () => {
    try {
      const { effectiveDisplaySize } = await import("./api/shared/display-profile.js");
      const size = effectiveDisplaySize(getDisplayProfile());
      return { maxW: size.width, maxH: size.height };
    } catch {
      return {};
    }
  })();
  resetCuttlefishLibraries();
  const graphResult = await collectTranspileGraph(entryFile, options.boardTarget, imageDecodeMax);
  profiler.endTimer("graph:collect");

  // Cuttlefish library packages registered during the graph walk — validate
  // them against the loaded framework (and build target, when known) before
  // any codegen. A framework/target mismatch is a hard error here, far
  // clearer than the native compiler's take on a missing header or node.
  validateCuttlefishLibraries(
    strategy.id,
    (options.platformContext?.frameworkData as { buildTarget?: string } | undefined)?.buildTarget,
  );

  const transpileFiles = graphResult.files;

  // ── Type-check all files before transpiling ────────────────────────────────
  // Skip type-checking if explicitly disabled
  let typeCheckProgram: ts.Program | undefined;
  if (options.skipTypeCheck !== true && transpileFiles.length > 0) {
    profiler.startTimer("typecheck:full");
    let typeCheckResult = typeCheckFiles(transpileFiles, options.boardTarget, entryFile);

    // If type-checking failed, try to auto-generate missing .d.ts files from C++ sources
    if (!typeCheckResult.success) {
      profiler.startTimer("typecheck:autogen-decls");
      const generatedDecls = autoGenerateMissingDecls(transpileFiles, typeCheckResult.errors);
      profiler.endTimer("typecheck:autogen-decls");

      // If we generated any declaration files, retry type-checking
      if (generatedDecls.length > 0) {
        profiler.startTimer("typecheck:retry");
        typeCheckResult = typeCheckFiles(transpileFiles, options.boardTarget, entryFile);
        profiler.endTimer("typecheck:retry");
      }
    }
    profiler.endTimer("typecheck:full");

    if (!typeCheckResult.success) {
      // Report all type errors and throw to stop transpilation
      const errorMessages = typeCheckResult.errors.map(e => `ERROR: ${e}`).join("\n");
      throw new Error(`TypeScript type-checking failed:\n${errorMessages}\n\nTranspilation aborted due to TypeScript errors.`);
    }
    // Capture the program for the semantic-gates pass (Phase 3) so we don't
    // rebuild it.
    typeCheckProgram = typeCheckResult.program;
  }

  // ── ESLint gate ──────────────────────────────────────────────────────────
  // ESLint catches what the type-checker cannot (idiom violations, banned
  // globals, explicit `any`, etc.). It is a mandatory correctness gate: it
  // excludes non-AOT code patterns the transpiler cannot accept, so it cannot
  // be dropped. Errors abort the build, mirroring the type-check behavior
  // above. Skipped alongside type-checking when disabled.
  //
  // Because the lint result is a whole-program boolean that depends only on
  // the source files, the eslint config, and the eslint/transpiler versions,
  // it is cacheable. On a cache hit we skip the ~3s ESLint run entirely; on a
  // miss we run ESLint and, only if clean, persist the result. See lint-cache.ts
  // for the soundness contract.
  if (options.skipLint !== true && options.skipTypeCheck !== true && transpileFiles.length > 0) {
    // The eslint config lives at the project root (next to typecad-hal.config.ts),
    // not under src/. Fall back to entryDir for ad-hoc API/test callers that pass
    // a bare input file without a configured project.
    const eslintRoot = options.projectRoot ?? entryDir;
    const lintCache = checkLintCache(eslintRoot, sourceDir, { force: options.force });

    if (lintCache.hit) {
      // Cache hit: previous clean run still applies, skip ESLint entirely.
      profiler.startTimer("lint:eslint:cached");
      profiler.endTimer("lint:eslint:cached");
    } else {
      profiler.startTimer("lint:eslint");
      const eslintErrors = await runEslintCheck(eslintRoot);
      profiler.endTimer("lint:eslint");

      if (eslintErrors.length > 0) {
        // Abort with a formatted message. The structured-diagnostic channel is
        // not populated here because a thrown error discards the output anyway;
        // printEslintErrors gives the user file/line/column/caret directly.
        // Do NOT persist a cache entry for a failing run.
        printEslintErrors(eslintErrors);
        throw new Error(`ESLint reported ${eslintErrors.length} error${eslintErrors.length === 1 ? "" : "s"} — transpilation aborted.`);
      }

      // Clean run: record the fingerprint so subsequent unchanged builds skip.
      if (lintCache.fingerprint) {
        recordLintSuccess(eslintRoot, lintCache.fingerprint);
      }
    }
  }
  const npmPackages = graphResult.npmPackages;

  const definitions = loadLibraryDefinitions(sourceDir);

  // Cuttlefish library packages: the import resolves to the library's shim
  // include (e.g. '"__tc_rgbled.h"') instead of a transpiled module header.
  // Project-local .libdef.json files keep precedence.
  for (const libdef of cuttlefishLibraryLibdefs()) {
    const key = libraryDefinitionKey(libdef.module);
    if (!definitions.has(key)) {
      definitions.set(key, libdef);
    }
  }

  let entryOutputs: GeneratedOutputs | undefined;
  const diagnostics = [] as GeneratedOutputs["diagnostics"];
  const allRemovedSymbols: string[] = [];

  // themeCss is only honored on the .ui.html disk-read path (loadUIModule).
  // For a .ui single-file entry the inline <style> is the sole CSS source; the
  // standalone file is silently ignored. Warn so authors don't maintain a dead
  // stylesheet.
  if (configDisplay?.themeCss) {
    const entryExt = path.extname(options.inputFile).toLowerCase();
    if (entryExt === ".ui") {
      diagnostics.push({
        severity: "warning",
        code: "themeCss-ui-entry-ignored",
        message: `display.themeCss is ignored for .ui single-file entries; the inline <style> in ${path.basename(options.inputFile)} is the sole CSS source.`,
        hint: `Move the standalone CSS into the .ui file's <style> block, or change the entry to a .ts file that imports a .ui.html module.`,
        filePath: path.basename(options.inputFile),
      });
    }
  }

  // ── Parser-level warnings (unknown CSS properties / HTML tags) ────────────
  // The graph build above already loaded all .ui.html modules; surface their
  // parser warnings (unknown CSS properties, unknown HTML tags) here so the
  // author sees typos and unsupported features instead of silent drops.
  // Guarded: @typecad/ui is optional, so there may be no UI engine loaded.
  // --strict-css upgrades the css-* compatibility warnings to errors.
  if (hasUIHook()) {
    for (const mod of requireUIHook().allUIModules()) {
      for (const d of mod.diagnostics) {
        const upgraded = upgradeStrictCss(d, options.strictCss);
        diagnostics.push({ ...upgraded, filePath: d.filePath ?? path.basename(mod.htmlPath) });
      }
    }
  }

  // ── Semantic gates (Phase 3) ──────────────────────────────────────────────
  // Type-resolved checks that the syntactic feature-prescan cannot express:
  // heterogeneous array literals and cross-file new-on-interface. These reuse
  // the program built by typeCheckFiles. Surfaced as structured diagnostics
  // (severity "error"); if any are present, the build aborts below.
  if (typeCheckProgram) {
    profiler.startTimer("typecheck:semantic-gates");
    const semanticDiagnostics = runSemanticGates(typeCheckProgram, transpileFiles);
    profiler.endTimer("typecheck:semantic-gates");
    if (semanticDiagnostics.length > 0) {
      diagnostics.push(...semanticDiagnostics);
      throwIfFatalDiagnostics(semanticDiagnostics.map((diagnostic) => ({ diagnostic })));
    }
  }

  // ── Pass 1: build + tree-shake every IR and pre-compute polyfills ─────────
  // We need to process ALL files before emitting any of them so that
  // `registerAllEnumNames` can be called with the *complete* set of enum names.
  // Without this pre-pass, files processed early (e.g. peripherals.ts) would
  // not yet know about enum types defined in files processed later (e.g.
  // bus/i2c.ts), causing property-access expressions like `I2CSpeed.STANDARD`
  // to be emitted with `.` instead of the required C++ `::`.
  type PreBuiltFile = {
    filePath: string;
    programIR: ProgramIR;
    npmPackage: ReturnType<typeof npmPackages.get>;
  };

  // Load breakpoints if debug mode is enabled
  const breakpoints = options.debug ? loadBreakpoints(sourceDir) : undefined;

  // ── Determine files to transpile ─────────────────────────────────────────
  // Incremental builds are disabled, so every file in the graph is processed.
  // See incremental-cache.ts for why a partial rebuild cannot be sound without
  // rehydrating cached IR/metadata for the entire graph.
  const filesToProcess = transpileFiles;

  // ── Phase 0: Pre-scan all files for class declarations to build a
  // cross-module type registry. This is needed so that property access
  // on imported class instances (e.g. player.weaponName) resolve to the
  // correct C++ type during IR building, rather than falling back to "auto".
  const prebuiltClassMap = new Map<string, ClassIR>();
  const classSources: Array<{
    filePath: string;
    sourceText: string;
    declarations: ts.ClassDeclaration[];
  }> = [];
  for (const filePath of transpileFiles) {
    try {
      const sourceText = await fs.promises.readFile(filePath, "utf8");
      const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
      classSources.push({
        filePath,
        sourceText,
        declarations: source.statements.filter(ts.isClassDeclaration),
      });
    } catch {
      // File read/parse errors will be caught during actual IR building
    }
  }

  // Class annotations are reference types even when the referenced class is
  // declared in another file or later in the graph. Register every class name
  // before building any signatures so fields such as `player: Player` become
  // `Player*` consistently in the cross-module registry.
  const prebuildContext = new CompilationContext();
  prebuildContext.activeStrategy = strategy;
  for (const { declarations } of classSources) {
    for (const declaration of declarations) {
      if (!declaration.name) continue;
      prebuildContext.topLevelClassNames.add(declaration.name.text);
      prebuildContext.classTypeNames.add(declaration.name.text);
    }
  }
  contextStorage.run(prebuildContext, () => {
    for (const { filePath, sourceText, declarations } of classSources) {
      for (const declaration of declarations) {
        const classIR = classDeclarationToIR(
          declaration, filePath, sourceText, [], new Map(), new Map(), [], new Map());
        if (classIR && !prebuiltClassMap.has(classIR.name)) {
          prebuiltClassMap.set(classIR.name, classIR);
          prebuildContext.topLevelClasses.set(classIR.name, classIR);
        }
      }
    }
  });

  // ── Phase A: Build IR for all files (no tree-shaking yet) ────────────────
  // We need all IRs built before we can compute cross-module imports for
  // accurate tree-shaking across file boundaries.
  type RawIRFile = {
    filePath: string;
    programIR: ProgramIR;
    npmPackage: ReturnType<typeof npmPackages.get>;
  };

  const buildRawIR = async (filePath: string): Promise<RawIRFile> => {
    const fileBasename = path.basename(filePath);
    profiler.startTimer(`ir:build:${fileBasename}`);

    let sourceText = await fs.promises.readFile(filePath, "utf8");
    const fileExtension = path.extname(filePath).toLowerCase();

    // .ui single-file component: extract the <script> as the TS source, with an
    // injected `import { screen }` so the script can reference the in-file
    // template (registered as a UI module by the graph builder).
    if (fileExtension === ".ui") {
      const parts = requireUIHook().splitUiFile(sourceText);
      const baseName = path.basename(filePath, ".ui");
      sourceText = `import { screen } from './${baseName}.ui.html';\n` + parts.script;
    }

    // If the file imports the testing DSL (@typecad/hal/testing), run the
    // AST preprocessor to rewrite describe/it/expect/done calls into Serial
    // protocol statements. The preprocessor is engine-internal
    // (src/test-runner/) — always present.
    if (sourceText.includes("@typecad/hal/testing")) {
      sourceText = loadExpectPreprocessor()(sourceText, filePath);
    }

    // Printf instrumentation runs only in printf debug mode. In gdb mode
    // (e.g. ESP32-S3), --debug emits #line markers at the emit stage and
    // uses VS Code native breakpoints; the printf preprocessor is skipped
    // so the source reaches IR/emit unmodified. The preprocessor instruments
    // with the SAME strategy that emits below — its debug dialect must match
    // the runtime the generated code links against.
    const buildTarget = (options.platformContext?.frameworkData as { buildTarget?: string } | undefined)?.buildTarget;
    const debugMode = strategy.debugMode?.(buildTarget) ?? 'printf';
    if (options.debug && breakpoints && debugMode === 'printf') {
      const instrumented = debugPreprocess({
        fileName: filePath,
        breakpoints,
        source: sourceText,
        strategy,
      });
      sourceText = instrumented;
    }

    profiler.startTimer(`ir:build-ir:${fileBasename}`);
    const programIR = buildProgramIR(filePath, sourceText, options.boardTarget, prebuiltClassMap);
    profiler.endTimer(`ir:build-ir:${fileBasename}`);

    const npmPackage = npmPackages.get(filePath);
    profiler.endTimer(`ir:build:${fileBasename}`);
    return { filePath, programIR, npmPackage };
  };

  profiler.startTimer("ir:build-all");
  profiler.captureMemorySnapshot("ir:pre-build");
  // Load + parse the @typecad/hal source files ONCE for this transpile run.
  // buildProgramIR used to force-reload HAL per graph file (O(files) re-reads
  // and re-parses of all 28 HAL modules); warming it here makes the per-file
  // loadHALModules() call inside buildProgramIR a cheap no-op. A fresh run of
  // transpileFile always reaches this point, so edits to @typecad/hal source
  // are picked up on the next build.
  profiler.startTimer("ir:load-hal");
  loadHALModules(true);
  profiler.endTimer("ir:load-hal");
  // Fresh run, fresh resolved-op set: the lowering seams record every HAL op
  // they resolve (some never become IR nodes); analyzeProgram merges them into
  // the peripheral usage flags at emit. Without this reset, a watch-mode
  // rebuild in the same process would carry the previous program's ops over.
  resetTranspileResolvedHalOps();
  const rawIRArray = await Promise.all(filesToProcess.map(buildRawIR));
  profiler.captureMemorySnapshot("ir:post-build");
  profiler.endTimer("ir:build-all");

  // ── UI mount-time warnings (scroll memory budget, etc.) ─────────────────
  // Guarded: @typecad/ui is optional; no engine means no UI modules.
  // --strict-css upgrades the css-* compatibility warnings to errors.
  if (hasUIHook()) {
    for (const mod of requireUIHook().allUIModules()) {
      for (const d of mod.mountDiagnostics) {
        const upgraded = upgradeStrictCss(d, options.strictCss);
        diagnostics.push({ ...upgraded, filePath: d.filePath ?? path.basename(mod.htmlPath) });
      }
    }
  }

  throwIfFatalDiagnostics(
    rawIRArray.flatMap(({ filePath, programIR }) =>
      programIR.diagnostics.map((diagnostic) => ({ filePath, diagnostic })),
    ),
  );

  // ── Phase B: Compute cross-module import map ─────────────────────────────
  // For each file, determine which of its symbols are imported by other files
  // in the project. Those symbols become additional entry points for tree-shaking
  // so they aren't eliminated as "unused" when they're only consumed externally.
  profiler.startTimer("ir:cross-module-imports");
  const symbolExportedTo = new Map<string, Set<string>>(); // symbol → Set<filePath that defines it>
  const fileDefinedSymbols = new Map<string, Set<string>>(); // filePath → Set<symbol names>

  for (const { filePath, programIR } of rawIRArray) {
    const defined = new Set<string>();
    for (const fn of programIR.functions) defined.add(fn.originalName);
    for (const cls of programIR.classes) defined.add(cls.name);
    for (const e of programIR.enums) defined.add(e.name);
    for (const ta of programIR.typeAliases) defined.add(ta.name);
    fileDefinedSymbols.set(filePath, defined);
  }

  // For each file, look at its imports and record which symbols it imports
  // from other files in the project.
  const crossModuleImports = new Map<string, Set<string>>(); // filePath → symbols imported by OTHER files
  for (const { filePath, programIR } of rawIRArray) {
    for (const imp of programIR.imports) {
      // Resolve the import to find which file it comes from
      const resolved = resolveImport(filePath, imp.moduleSpecifier, options.boardTarget);
      if (!resolved) continue;
      const targetFile = resolved.sourcePath;
      // Only track imports from files in our transpile graph
      if (!fileDefinedSymbols.has(targetFile)) continue;
      for (const symbol of imp.namedImports) {
        if (!crossModuleImports.has(targetFile)) {
          crossModuleImports.set(targetFile, new Set());
        }
        crossModuleImports.get(targetFile)!.add(symbol);
      }
      // Handle default imports: import X from "./module.js"
      if (imp.defaultImportName) {
        // Find the target module's default export name
        const targetIR = rawIRArray.find(r => r.filePath === targetFile);
        if (targetIR?.programIR.defaultExportName) {
          if (!crossModuleImports.has(targetFile)) {
            crossModuleImports.set(targetFile, new Set());
          }
          crossModuleImports.get(targetFile)!.add(targetIR.programIR.defaultExportName);
        }
      }
    }
  }
  profiler.endTimer("ir:cross-module-imports");

  // ── Phase C: Tree-shake with cross-module awareness + compute polyfills ──
  const preBuiltArray: PreBuiltFile[] = [];
  for (const { filePath, programIR: rawIR, npmPackage } of rawIRArray) {
    const fileBasename = path.basename(filePath);

    // Detect symbols that other files import from this one
    const importedByOthers = crossModuleImports.get(filePath) ?? new Set<string>();
    const exportedEntryPoints = detectExportedEntryPoints(rawIR, importedByOthers);
    // Functions referenced by on:* HTML attributes (on:click="saveSettings") are
    // named-ref handlers — the click-handler table references them, but the TS
    // call-graph doesn't (the reference is in HTML). Keep them as tree-shake
    // entry points so they aren't stripped before the table is emitted.
    const onAttrEntryPoints = clickHandlers()
      .filter(h => h.isNamedRef)
      .map(h => h.fnName);

    profiler.startTimer(`tree-shake:${fileBasename}`);
    let shakingResult: { programIR: ProgramIR; removedSymbols: string[] };
    if (filePath === entryFile) {
      shakingResult = applyTreeShaking(rawIR, options.target, {
        ...options.treeShaking,
        keepUnusedVariables: options.treeShaking?.keepUnusedVariables ?? false,
        // Merge exported entry points so cross-module imports aren't shaken out,
        // plus on:* HTML-attribute handler refs (named fns not called in TS).
        entryPoints: [
          ...(options.treeShaking?.entryPoints ?? []),
          ...exportedEntryPoints,
          ...onAttrEntryPoints,
        ],
      });
    } else {
      shakingResult = applyTreeShaking(rawIR, options.target, {
        enabled: options.treeShaking?.enabled ?? true,
        keepUnusedEnums: true,
        keepUnusedClasses: options.treeShaking?.keepUnusedClasses,
        keepUnusedTypeAliases: options.treeShaking?.keepUnusedTypeAliases,
        reportUnused: options.treeShaking?.reportUnused,
        keepUnusedVariables: true,
        // Merge exported entry points so cross-module imports aren't shaken out,
        // plus on:* HTML-attribute handler refs (named fns not called in TS).
        entryPoints: [
          ...(options.treeShaking?.entryPoints ?? []),
          ...exportedEntryPoints,
          ...onAttrEntryPoints,
        ],
      });
    }
    const programIR = shakingResult.programIR;
    allRemovedSymbols.push(...shakingResult.removedSymbols);
    profiler.endTimer(`tree-shake:${fileBasename}`);

    preBuiltArray.push({ filePath, programIR, npmPackage });
  }

  const preBuilt = new Map<string, PreBuiltFile>();
  for (const item of preBuiltArray) {
    preBuilt.set(item.filePath, item);
  }

  // Collect ALL enum IRs from ALL files and register them before emitting.
  // This makes the property-access renderer and struct field type inference
  // aware of every enum type (including its member values for AVR range checks)
  // regardless of which file it's defined in or what order files are emitted.
  const allEnumIRs: { name: string; members: { name: string; value?: number | string }[] }[] = [];
  const allEnumNames = new Set<string>();
  const allStringEnumNames = new Set<string>();
  // Cross-file symbol/type aggregation. This used to be ~90 lines of hand-rolled
  // loops building allClassFieldTypes / allClassAccessors /
  // allFunctionReturnTypes / allVariableTypes / allClassNames in two passes
  // (own fields, then extendsClass inheritance). It is now a single
  // SymbolTable built per file, merged across files, with inheritance resolved
  // once — see ir/symbol-table.ts. The projected maps below keep the exact
  // names/shapes the emit phase consumes, so this is a behavior-neutral swap.
  const crossModuleTable = createSymbolTable();
  for (const { programIR } of preBuilt.values()) {
    for (const e of programIR.enums) {
      allEnumIRs.push(e);
      allEnumNames.add(e.name);
      if (isStringEnum(e)) allStringEnumNames.add(e.name);
    }
    for (const ns of programIR.namespaces) {
      for (const e of ns.enums) {
        allEnumIRs.push(e);
        allEnumNames.add(e.name);
        if (isStringEnum(e)) allStringEnumNames.add(e.name);
      }
    }
    mergeSymbolTable(crossModuleTable, buildSymbolTable(programIR));
  }
  resolveInheritance(crossModuleTable);
  const allClassNames = crossModuleTable.classNames;
  const allClassFieldTypes = crossModuleTable.classFieldTypes;
  const allClassAccessors = crossModuleTable.classAccessors;
  const allFunctionReturnTypes = crossModuleTable.functionReturnTypes;
  const allVariableTypes = crossModuleTable.variableTypes;
  profiler.startTimer("emit:register-enums");
  registerAllEnumNames(allEnumIRs);
  profiler.endTimer("emit:register-enums");

  // ── Phase D: safety transform pass ──────────────────────────────────────
  // When @typecad/safety is in use, run its post-build IR transform to inject
  // safety ops (e.g. companion safety.record_pin_mode after every
  // gpio.pin_mode). Produces new IR per file; no-op when safety is off or
  // absent.
  if (hasSafetyHook()) {
    profiler.startTimer("safety:transform");
    const hook = requireSafetyHook();
    for (const [filePath, item] of preBuilt) {
      const newIR = hook.transformIR(item.programIR, {
        safetyInUse: entryImportsSafety(item.programIR),
        target: options.target,
      });
      preBuilt.set(filePath, { ...item, programIR: newIR });
    }
    profiler.endTimer("safety:transform");

    // Part B: ISO 26262 Part 6 read-only IR analysis. Runs after transformIR
    // so it sees the final IR (including injected safety ops). Returned
    // diagnostics flow into the build's diagnostic list; error-severity
    // diagnostics abort via throwIfFatalDiagnostics.
    if (hook.analyzeIR) {
      profiler.startTimer("safety:analyze");
      for (const [, item] of preBuilt) {
        const irDiags = hook.analyzeIR(item.programIR, {
          safetyInUse: entryImportsSafety(item.programIR),
          target: options.target,
        });
        if (irDiags.length > 0) {
          diagnostics.push(...irDiags);
        }
      }
      profiler.endTimer("safety:analyze");
    }

    // Part C: collect safety metadata and write sidecar artifact.
    if (hook.collectSafetyMetadata) {
      profiler.startTimer("safety:collect");
      for (const [filePath, item] of preBuilt) {
        if (!entryImportsSafety(item.programIR)) continue;
        const metadata = hook.collectSafetyMetadata(item.programIR, {
          safetyInUse: true,
          target: options.target,
        });
        if (metadata.length > 0 && metadata[0].functions.length > 0) {
          const { renderSafetySidecar } = await import("./safety/sidecar-bridge.js");
          const toolVersion = CUTTLEFISH_VERSION;
          const sidecarPath = path.join(outDir, path.basename(filePath).replace(/\.\w+$/, ".safety-sidecar.json"));
          const sidecarJson = await renderSafetySidecar(metadata[0], toolVersion);
          writeText(sidecarPath, sidecarJson);
        }
      }
      profiler.endTimer("safety:collect");
    }
  }

  // ── Pass 2: emit (only for files that needed retranspilation) ─────────────
  profiler.startTimer("emit:all");
  profiler.captureMemorySnapshot("emit:pre");
  for (const [filePath, { programIR, npmPackage }] of preBuilt) {
    const fileBasename = path.basename(filePath);
    profiler.startTimer(`emit:file:${fileBasename}`);

    const emitOptions: Parameters<typeof emitCpp>[1] = {
      outDir,
      emitMode: options.emitMode,
      target: options.target,
      libdefs: definitions,
      emitMaps: options.emitMaps,
      platformContext: options.platformContext,
      npmPackage,
      npmPackages,
      isEntryFile: filePath === entryFile,
      nativeModules: graphResult.nativeModules,
      crossModuleClasses: allClassNames,
      crossModuleClassFieldTypes: allClassFieldTypes,
      crossModuleClassAccessors: allClassAccessors,
      crossModuleFunctionReturnTypes: allFunctionReturnTypes,
      crossModuleEnumNames: allEnumNames,
      crossModuleStringEnumNames: allStringEnumNames,
      crossModuleVariableTypes: allVariableTypes,
      autosar: options.autosar,
      toolVersion: CUTTLEFISH_VERSION,
      autosarArxml: options.autosarArxml,
    };
    // Pass the already-resolved strategy (framework-loaded or target-based)
    emitOptions.strategy = strategy;
    const emitted = emitCpp(programIR, emitOptions);

    diagnostics.push(...emitted.diagnostics);
    throwIfFatalDiagnostics(emitted.diagnostics.map((diagnostic) => ({ filePath, diagnostic })));
    if (filePath === entryFile) {
      entryOutputs = emitted;
    }

    profiler.endTimer(`emit:file:${fileBasename}`);
  }
  profiler.captureMemorySnapshot("emit:post");
  profiler.endTimer("emit:all");

  // The entry file is always emitted above (incremental builds are disabled,
  // so every graph file is processed). Guard against the impossible case where
  // emit somehow produced no entry output.
  if (!entryOutputs) {
    throw new Error(`Unable to transpile entry file '${entryFile}'.`);
  }

  // ── Copy native C++ modules to output ─────────────────────────────────────
  profiler.startTimer("post:native-modules");
  const nativeModuleOutputs: string[] = [];
  for (const [moduleSpecifier, nativeModule] of graphResult.nativeModules) {
    // Skip copying — framework libraries provide both .h and .cpp.
    // Copying either causes conflicts: the .cpp merges into the entry source
    // (duplicate definitions), and the .h shadows the library's own header
    // (link failures). The gen-decls .d.ts files are sufficient for TS
    // type-checking.
    info(`Native module (library-managed): ${moduleSpecifier}`);
  }
  profiler.endTimer("post:native-modules");

  profiler.startTimer("post:flatten");
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    if (toolchain?.prepare) {
      try {
        toolchain.prepare(path.dirname(entryOutputs.sourcePath), entryOutputs.sourcePath);
      } catch (e) {
        if (process.env.TYPECAD_HAL_DEBUG) console.error("[transpile] Toolchain prepare failed:", e);
      }
    }
  }
  profiler.endTimer("post:flatten");

  // Remove stale generated sources (renamed entries, removed modules) so
  // downstream globs (Zephyr's CMakeLists src/*.cpp) don't compile leftovers
  // into duplicate-symbol link errors. Runs after every write of this run,
  // including the toolchain prepare hook above.
  profiler.startTimer("post:sweep-stale");
  sweepStaleGeneratedSources(outDir);
  profiler.endTimer("post:sweep-stale");

  // Profiler session ends (profiling disabled - no report generation)

  // ── Generate diagnostics report if enabled ──────────────────────────────
  let diagnosticsReportPath: string | undefined;
  if (options.diagnostics) {
    try {
      const entryPreBuilt = preBuilt.get(entryFile);
      const report = buildDiagnosticsReport({
        entryFile,
        program: entryPreBuilt?.programIR ?? null,
        diagnostics,
        asyncTaskNames: entryOutputs.asyncTaskNames ?? [],
        usesTimers: entryOutputs.usesTimers ?? false,
        target: options.target,
        boardTarget: options.boardTarget,
        frameworkPackage: options.frameworkPackage,
        outDir,
        outputFile: entryOutputs.sourcePath,
        preBuilt,
        profiler,
        removedSymbols: allRemovedSymbols,
      });
      writeDiagnosticsReport(report, entryPreBuilt?.programIR ?? null, outDir);
      diagnosticsReportPath = path.join(outDir, "diagnostics.md");
    } catch (e) {
      // Diagnostics report generation is best-effort; don't fail the build,
      // but surface the failure so the user knows --diagnostics didn't work.
      diagnostics.push({
        severity: "warning",
        message: `Diagnostics report generation failed: ${e instanceof Error ? e.message : String(e)}`,
        code: "diagnostics-report-failed",
        source: "transpile",
      });
    }
  }

  // ── Persist the resolved board constants next to the emitted source ─────
  // Framework toolchains re-read this at compile time to rebuild their chip
  // descriptors (framework-zephyr's resolveChipFromBoard). Board packages
  // carry chip data — controller splits, ADC channel maps, PWM specs — that
  // lives only in the board package, so without this file the toolchain's
  // registry fallback silently resolves board-derived targets (rpi_pico,
  // esp32c3/c6, blackpill) to the XIAO default descriptor.
  try {
    // Read from the built program IRs — the IR build context (and its
    // current-board-constants slot) is already closed at this point. Any
    // file's IR may carry the constants (the board import is traversed while
    // building whichever file imports it first), so scan for a populated one.
    let boardConstants: (typeof preBuilt extends Map<string, { programIR: infer P }> ? P extends { boardConstants?: infer B } ? B : never : never) | undefined;
    for (const pb of preBuilt.values()) {
      const bc = pb.programIR.boardConstants;
      if (bc && bc.size > 0) { boardConstants = bc; break; }
    }
    if (boardConstants && boardConstants.size > 0) {
      fs.writeFileSync(
        path.join(outDir, "board-constants.json"),
        JSON.stringify(Object.fromEntries(boardConstants), null, 2),
      );
    }
  } catch {
    // Best-effort persistence; the toolchain falls back to its registry.
  }

  // ── Cuttlefish library packages: shims + libraries.json sidecar ─────────
  // Shims are written next to the emitted sources (the framework scaffold's
  // CMake/program regen compiles them); the sidecar records the used
  // libraries' build contributions (Kconfig lines, overlay fragments) for
  // the framework toolchain — the board-constants.json convention.
  try {
    const emittedSrcDir = entryOutputs ? path.dirname(entryOutputs.sourcePath) : outDir;
    writeCuttlefishLibraryArtifacts(outDir, emittedSrcDir);
  } catch {
    // Best-effort; a missing shim surfaces at native compile time.
  }

  return {
    ...entryOutputs,
    diagnostics,
    diagnosticsReportPath,
  };
}
