/*
LLM TRANSPILER GUIDE
====================

This comment block is intended as a readme-style guide for language models and future maintainers
who are investigating or extending the TypeCAD transpiler. It is deliberately placed at the top of
`packages/transpiler/src/transpile.ts` so it is found during normal code exploration.

Key files:
  - packages/transpiler/src/cli.ts                : main CLI entry, command dispatch, build/watch flows
  - packages/transpiler/src/utils/cli.ts          : CLI option parser, command validation, help text
  - packages/transpiler/src/transpile.ts          : transpilation pipeline, import resolution, emit orchestration
  - packages/transpiler/src/emit/cpp-emitter.ts   : C++ emission logic and platform-specific codegen
  - packages/transpiler/src/config-loader.ts      : cuttlefish.config.ts loading and board/package config
  - packages/transpiler/src/cli-utils.ts          : shared CLI helpers like expect test runner and error mapping
  - packages/transpiler/src/mapping/source-map.ts : source map I/O and C++ → TypeScript error mapping
  - packages/transpiler/src/watch.ts              : watch mode, directory discovery, rebuild callbacks

Main code paths for creating or evaluating transpilation
--------------------------------------------------------
1. CLI command entry
   - `packages/transpiler/src/cli.ts` is the application's entrypoint.
   - `main()` calls `parseCommandLine(process.argv)` from `packages/transpiler/src/utils/cli.ts`.
   - CLI parsing produces one of: `default`, `build`, `gen-libdefs`, `gen-decls`, `map-error`, `create-board`, `init`.
   - For `default` and `build`, CLI options are normalized and passed into the transpilation flow.

2. Config loading and effective option resolution
   - `loadCuttlefishConfig()` from `packages/transpiler/src/config-loader.ts` reads `cuttlefish.config.ts`.
   - Config values override CLI-supplied flags for board package, fqbn, target, outDir, framework, and console settings.
   - `generateVirtualTypeDeclaration()` is used to keep editor type resolution aligned with bare `@typecad` imports.

3. Transpilation flow
   - The main runtime entry is `transpileFile(options)` in this file.
   - `transpileFile()` performs these high-level steps:
       a. Resolve the input file and watch/config context.
       b. Collect the dependency graph and resolve imports.
       c. Type-check the candidate files (unless `skipTypeCheck` is set).
       d. Build IR for every file via `buildProgramIR()`.
       e. Tree-shake and filter the program IR.
       f. Register enum metadata with `registerAllEnumNames()`.
       g. Emit C++/headers with `emitCpp()`.
       h. Write generated files and source maps.
   - Output is a `GeneratedOutputs` object with generated paths and diagnostics.

4. Import resolution and source discovery
   - `resolveImport()` decides whether an import is local or npm-based.
   - `resolveLocalImport()` handles relative TypeScript imports and `.js` / `.mjs` rewrite patterns.
   - `resolveNpmPackageImport()` locates packages in `node_modules` and monorepo layouts, and tries exports-to-source mapping.
   - `detectNativeCppModule()` identifies `.d.ts` + `.cpp` pairs used for native bindings.
   - `getNpmPackageInfoForFile()` maps a file path back to its npm package metadata after resolution.

5. Type-checking and diagnostics
   - `typeCheckFiles()` performs TS compilation and reports errors before emission.
   - Diagnostics are surfaced via `GeneratedOutputs.diagnostics`.
   - CLI output uses `printDiagnostics()` in `packages/transpiler/src/cli-utils.ts`.
   - A build may still produce generated outputs alongside warnings and errors.

6. Emission and platform strategy
   - `emitCpp()` in `packages/transpiler/src/emit/cpp-emitter.ts` is the emission engine.
   - It consumes IR, platform strategy, board constants, and polyfills.
   - `registerAllEnumNames()` is required before emission to keep enum access normalization correct.
   - For Arduino, `flattenGeneratedModulesIntoSketch()` is used to create an `.ino` sketch.

7. Source maps and error mapping
   - Generated output may include source maps via `emitMaps`.
   - `packages/transpiler/src/mapping/source-map.ts` reads and maps C++ error locations back to TypeScript.
   - `printMappedCompileErrors()` in `packages/transpiler/src/cli-utils.ts` uses this mapping during Arduino compile failures.

8. Watch mode and incremental rebuilds
   - `packages/transpiler/src/watch.ts` handles filesystem watch events and rebuild callbacks.
   - `discoverWatchDirs()` finds relevant directories for the entry file and config file.
   - Incremental rebuilds use `packages/transpiler/src/incremental-cache.ts` when enabled.
   - Watch mode still goes through `transpileFile()` on each rebuild, but may bypass unchanged files.

9. @typecad/expect support and preprocessing
   - Code that imports `@typecad/expect` is transformed by the preprocessor.
   - `loadExpectPreprocessor()` loads `@typecad/expect/preprocessor` lazily to avoid startup dependency failures.
   - `runExpectTests()` in `packages/transpiler/src/cli-utils.ts` is the runtime test harness invoked after transpilation/upload.

Common extension checklist for new transpiler features
------------------------------------------------------
  1. Decide whether the feature belongs to CLI parsing, config behavior, transpile graph resolution, emit logic, or runtime support.
  2. Add the new option/command to `packages/transpiler/src/types.ts`.
  3. Parse CLI flags in `packages/transpiler/src/utils/cli.ts`.
  4. Wire command behavior in `packages/transpiler/src/cli.ts`.
  5. Implement transpilation behavior in `packages/transpiler/src/transpile.ts` or `packages/transpiler/src/emit/*`.
  6. Preserve diagnostics, source maps, and default `watch` semantics.
  7. Add tests under `tests/` for the new CLI behavior and transpilation path.

Important design notes
----------------------
  - Keep the CLI surface separate from the transpiler runtime. CLI files should only handle parsing, config, and orchestration.
  - Transpilation should be driven by a single `transpileFile()` entrypoint, with internal helpers for resolution and IR building.
  - Avoid adding new global mutable state in the emitter; prefer explicit context objects.
  - Maintain a clear distinction between TypeScript source imports, npm package source resolution, and native module declarations.

Search tokens:
  - LLM TRANSPILER GUIDE
  - LLM API MAP
  - TRANSPILE TASKS
  - MAIN CODE PATHS
  - TRANSPILE FLOW
*/

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { buildProgramIR } from "./ir/build-ir";
import { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter";
import { GenerateLibdefOptions, GeneratedOutputs, TranspileOptions, TreeShakingOptions } from "./types";
import { readText } from "./utils/fs";
import { debug as logDebug, info } from "./utils/logger";
import { loadLibraryDefinitions, generateLibdefStubs } from "./libdef/registry";
import type { ProgramIR } from "./api";
import { buildCallGraph } from "./ir/call-graph";
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
} from "./cache";
import {
  IncrementalCache,
  initIncrementalCache,
  getIncrementalCache,
  saveAndClearIncrementalCache,
} from "./incremental-cache";
import { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points";
import { analyzeReachability } from "./ir/reachability";
import { filterProgramIR } from "./ir/filter";
import { setActiveStrategy } from "./ir/hal-resolver";
import { loadBreakpoints, preprocess as debugPreprocess } from "./debug";
import { collectTranspileGraph } from "./orchestrator/graph-builder";
import { typeCheckFiles } from "./orchestrator/type-checker";
import { autoGenerateMissingDecls } from "./orchestrator/dts-generator";
import { initProfiler, getProfiler } from "./profiler";
import { buildDiagnosticsReport, writeDiagnosticsReport } from "./diagnostics/diagnostics-report";
import {
  ResolvedNpmPackage,
  NativeCppModule,
  TranspileGraphResult,
  detectNativeCppModule,
  getNpmPackageInfoForFile,
  isInNodeModules,
  resolveImport,
  isCuttlefishSDKPath,
} from "./transpile/resolution";
type ExpectPreprocessor = (source: string, fileName?: string) => string;
let expectPreprocess: ExpectPreprocessor | undefined;

function loadExpectPreprocessor(): ExpectPreprocessor | undefined {
  if (expectPreprocess) {
    return expectPreprocess;
  }
  try {
    const mod = require("@typecad/expect/preprocessor");
    expectPreprocess = mod?.preprocess;
    return expectPreprocess;
  } catch {
    return undefined;
  }
}

function cleanOutput(entryDir: string, outDir: string): void {
  const cachePath = path.join(entryDir, ".cuttlefish-cache.json");
  try { if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath); } catch { /* ignore */ }
  try { if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

  

/**
 * Auto-generates .d.ts files for C++ modules that are missing declarations.
 * Also tries to generate declarations for framework libraries.
 * Returns list of generated files.
 */


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

import type { PlatformStrategy } from "./api/shared";
import { resolveStrategy } from "./platform/registry";
import { loadFrameworkPackage } from "./framework-package";
import { getLoadedFramework, hasLoadedFramework } from "./framework-registry";

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
  _boardPackage: string | undefined,
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
        logDebug(`Loaded FrameworkStrategy from ${frameworkPackage}`, true);
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

  const entryFile = path.resolve(options.inputFile);
  const entryDir = path.dirname(entryFile);
  const sourceDir = entryDir;
  const sketchBaseName = path.basename(entryFile).replace(/\.[^.]+$/, "");
  const outBaseDir = options.outDir ?? sourceDir;

  profiler.endTimer("setup:caches");

  profiler.startTimer("setup:load-strategy");
  // Load platform strategy from framework or board package, or use target-based resolution
  const boardStrategy = loadPlatformStrategy(
    options.frameworkPackage,
    options.boardPackage,
    entryDir,
    options.debug,
  );
  profiler.endTimer("setup:load-strategy");

  // Use the framework-loaded strategy for output path computation if available,
  // otherwise fall back to target-based resolution.  This ensures a single
  // consistent strategy drives both the output directory and emission.
  const strategy = boardStrategy ?? resolveStrategy(options.target);
  setActiveStrategy(strategy);
  const outDir = path.join(outBaseDir, strategy.outputSubdirectory(sketchBaseName));

  // Always start fresh: delete cache and output directory
  cleanOutput(entryDir, outDir);

  // Initialize incremental cache (always starts empty since we deleted the file)
  let incrementalCache: IncrementalCache | null = null;
  if (!options.force) {
    incrementalCache = initIncrementalCache({
      rootDir: entryDir,
      enabled: true,
    });
  }

  profiler.startTimer("graph:collect");
  const graphResult = collectTranspileGraph(entryFile, options.boardPackage);
  profiler.endTimer("graph:collect");

  const transpileFiles = graphResult.files;

  // ── Type-check all files before transpiling ────────────────────────────────
  // Skip type-checking if explicitly disabled
  if (options.skipTypeCheck !== true && transpileFiles.length > 0) {
    profiler.startTimer("typecheck:full");
    let typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage, entryFile);

    // If type-checking failed, try to auto-generate missing .d.ts files from C++ sources
    if (!typeCheckResult.success) {
      profiler.startTimer("typecheck:autogen-decls");
      const generatedDecls = autoGenerateMissingDecls(transpileFiles, typeCheckResult.errors);
      profiler.endTimer("typecheck:autogen-decls");

      // If we generated any declaration files, retry type-checking
      if (generatedDecls.length > 0) {
        profiler.startTimer("typecheck:retry");
        typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage, entryFile);
        profiler.endTimer("typecheck:retry");
      }
    }
    profiler.endTimer("typecheck:full");

    if (!typeCheckResult.success) {
      // Report all type errors and throw to stop transpilation
      const errorMessages = typeCheckResult.errors.map(e => `ERROR: ${e}`).join("\n");
      throw new Error(`TypeScript type-checking failed:\n${errorMessages}\n\nTranspilation aborted due to TypeScript errors.`);
    }
  }
  const npmPackages = graphResult.npmPackages;

  const definitions = loadLibraryDefinitions(sourceDir);

  let entryOutputs: GeneratedOutputs | undefined;
  const diagnostics = [] as GeneratedOutputs["diagnostics"];
  const allRemovedSymbols: string[] = [];

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

  // ── Incremental cache: determine which files need retranspilation ─────────
  let filesToProcess: string[];
  const cachedOutputs = new Map<string, string[]>();
  
  if (incrementalCache && incrementalCache.isEnabled()) {
    const changeStatuses = incrementalCache.getFilesNeedingRetranspile(transpileFiles);
    
    filesToProcess = [];
    for (const status of changeStatuses) {
      if (status.needsRetranspile) {
        filesToProcess.push(status.filePath);
      } else {
        // File is unchanged - get cached outputs
        const outputs = incrementalCache.getCachedOutputs(status.filePath);
        if (outputs) {
          cachedOutputs.set(status.filePath, outputs);
        }
      }
    }
    
    if (options.debug && filesToProcess.length < transpileFiles.length) {
      const skipped = transpileFiles.length - filesToProcess.length;
      logDebug(`Incremental: skipping ${skipped} unchanged file(s)`, true);
    }
  } else {
    filesToProcess = transpileFiles;
  }

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

    // If the file imports @typecad/expect, run the AST preprocessor
    // to rewrite describe/it/expect/done calls into Serial protocol statements.
    if (sourceText.includes("@typecad/expect")) {
      const preprocess = loadExpectPreprocessor();
      if (!preprocess) {
        throw new Error(
          "The @typecad/expect package is required to transpile files that import @typecad/expect. " +
          "Install @typecad/expect or remove the import."
        );
      }
      sourceText = preprocess(sourceText, filePath);
    }

    if (options.debug && breakpoints) {
      const instrumented = debugPreprocess({
        fileName: filePath,
        breakpoints,
        source: sourceText,
      });
      sourceText = instrumented;
    }

    profiler.startTimer(`ir:build-ir:${fileBasename}`);
    const programIR = buildProgramIR(filePath, sourceText, options.boardPackage);
    profiler.endTimer(`ir:build-ir:${fileBasename}`);

    const npmPackage = npmPackages.get(filePath);
    profiler.endTimer(`ir:build:${fileBasename}`);
    return { filePath, programIR, npmPackage };
  };

  profiler.startTimer("ir:build-all");
  profiler.captureMemorySnapshot("ir:pre-build");
  const rawIRArray = await Promise.all(filesToProcess.map(buildRawIR));
  profiler.captureMemorySnapshot("ir:post-build");
  profiler.endTimer("ir:build-all");

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
      const resolved = resolveImport(filePath, imp.moduleSpecifier, options.boardPackage);
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
      // Handle default imports: import X from "./module"
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

    profiler.startTimer(`tree-shake:${fileBasename}`);
    let shakingResult: { programIR: ProgramIR; removedSymbols: string[] };
    if (filePath === entryFile) {
      shakingResult = applyTreeShaking(rawIR, options.target, {
        ...options.treeShaking,
        keepUnusedVariables: options.treeShaking?.keepUnusedVariables ?? false,
        // Merge exported entry points so cross-module imports aren't shaken out
        entryPoints: [
          ...(options.treeShaking?.entryPoints ?? []),
          ...exportedEntryPoints,
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
        // Merge exported entry points so cross-module imports aren't shaken out
        entryPoints: [
          ...(options.treeShaking?.entryPoints ?? []),
          ...exportedEntryPoints,
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
  // Also collect all class names across all files for forward declarations.
  const allClassNames = new Set<string>();
  for (const { programIR } of preBuilt.values()) {
    for (const e of programIR.enums) {
      allEnumIRs.push(e);
    }
    for (const ns of programIR.namespaces) {
      for (const e of ns.enums) {
        allEnumIRs.push(e);
      }
    }
    for (const cls of programIR.classes) {
      allClassNames.add(cls.name);
    }
  }
  profiler.startTimer("emit:register-enums");
  registerAllEnumNames(allEnumIRs);
  profiler.endTimer("emit:register-enums");

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
    };
    // Pass the already-resolved strategy (framework-loaded or target-based)
    emitOptions.strategy = strategy;
    const emitted = emitCpp(programIR, emitOptions);

    diagnostics.push(...emitted.diagnostics);
    if (filePath === entryFile) {
      entryOutputs = emitted;
    }

    // Update incremental cache with the emitted outputs
    if (incrementalCache && incrementalCache.isEnabled()) {
      const outputs = [
        emitted.sourcePath,
        emitted.headerPath,
        emitted.sourceMapPath,
        emitted.headerMapPath,
      ].filter((p): p is string => p !== undefined);

      // Get dependencies from program IR imports
      const dependencies = programIR.imports
        .map(imp => resolveImport(filePath, imp.moduleSpecifier, options.boardPackage)?.sourcePath)
        .filter((p): p is string => p !== undefined);

      // Read the source file content for hashing
      const sourceContent = await fs.promises.readFile(filePath, "utf8");
      incrementalCache.updateFile(filePath, sourceContent, dependencies, outputs);
    }
    profiler.endTimer(`emit:file:${fileBasename}`);
  }
  profiler.captureMemorySnapshot("emit:post");
  profiler.endTimer("emit:all");

  // ── Handle fully cached builds ────────────────────────────────────────────
  if (!entryOutputs) {
    // Check if the entry file was cached (no files needed retranspilation)
    const cachedEntryOutputs = cachedOutputs.get(entryFile);
    if (cachedEntryOutputs && cachedEntryOutputs.length > 0) {
      // All files were cached - return the cached entry file outputs
      const sourcePath = cachedEntryOutputs.find(p => p.endsWith(".cpp") || p.endsWith(".ino"));
      const headerPath = cachedEntryOutputs.find(p => p.endsWith(".h"));
      const sourceMapPath = cachedEntryOutputs.find(p => p.endsWith(".cpp.map") || p.endsWith(".ino.thcppmap.json"));
      const headerMapPath = cachedEntryOutputs.find(p => p.endsWith(".h.map"));
      
      if (sourcePath) {
        // Log that we're using cached outputs
        if (options.debug) {
          logDebug(`Incremental: all files unchanged, using cached outputs`, true);
        }
        
        entryOutputs = {
          sourcePath,
          headerPath,
          sourceMapPath,
          headerMapPath,
          diagnostics: [],
        };
      }
    }
    
    if (!entryOutputs) {
      throw new Error(`Unable to transpile entry file '${entryFile}'.`);
    }
  }

  // ── Copy native C++ modules to output ─────────────────────────────────────
  profiler.startTimer("post:native-modules");
  const nativeModuleOutputs: string[] = [];
  for (const [moduleSpecifier, nativeModule] of graphResult.nativeModules) {
    // Read the C++ source
    const cppContent = readText(nativeModule.cppPath);

    // Write to output directory
    const outputCppPath = path.join(outDir, `${nativeModule.moduleKey}.cpp`);
    fs.writeFileSync(outputCppPath, cppContent, "utf8");
    nativeModuleOutputs.push(outputCppPath);

    // Also copy the header file if it exists
    if (nativeModule.headerPath) {
      const headerContent = readText(nativeModule.headerPath);
      const outputHeaderPath = path.join(outDir, `${nativeModule.moduleKey}.h`);
      fs.writeFileSync(outputHeaderPath, headerContent, "utf8");
      nativeModuleOutputs.push(outputHeaderPath);
    }

    info(`Copied native module: ${outputCppPath}`);
  }
  profiler.endTimer("post:native-modules");

  profiler.startTimer("post:flatten");
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    if (toolchain?.prepare) {
      try {
        toolchain.prepare(path.dirname(entryOutputs.sourcePath), entryOutputs.sourcePath);
      } catch {
        // Best-effort post-processing for compilation.
      }
    }
  }
  profiler.endTimer("post:flatten");

  profiler.startTimer("post:save-cache");
  // Save incremental cache to disk
  if (incrementalCache) {
    incrementalCache.save();
  }
  profiler.endTimer("post:save-cache");
  // Profiler session ends (profiling disabled - no report generation)

  // ── Generate diagnostics report if enabled ──────────────────────────────
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
        boardPackage: options.boardPackage,
        frameworkPackage: options.frameworkPackage,
        outDir,
        outputFile: entryOutputs.sourcePath,
        preBuilt,
        profiler,
        removedSymbols: allRemovedSymbols,
      });
      writeDiagnosticsReport(report, entryPreBuilt?.programIR ?? null, outDir);
    } catch (e) {
      // Diagnostics report generation is best-effort; don't fail the build
      if (options.debug) {
        logDebug(`Diagnostics report generation failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
  }

  return {
    ...entryOutputs,
    diagnostics,
  };
}

export function generateLibraryDefinitions(options: GenerateLibdefOptions): string[] {
  const sourceText = readText(options.inputFile);
  const programIR = buildProgramIR(options.inputFile, sourceText);
  return generateLibdefStubs(options.inputFile, programIR.imports, options.outDir);
}
