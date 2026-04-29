/*
LLM TRANSPILER GUIDE
====================

This comment block is intended as a readme-style guide for language models and future maintainers
who are investigating or extending the TypeHAL transpiler. It is deliberately placed at the top of
`packages/transpiler/src/transpile.ts` so it is found during normal code exploration.

Key files:
  - packages/transpiler/src/cli.ts                : main CLI entry, command dispatch, build/watch flows
  - packages/transpiler/src/utils/cli.ts          : CLI option parser, command validation, help text
  - packages/transpiler/src/transpile.ts          : transpilation pipeline, import resolution, emit orchestration
  - packages/transpiler/src/emit/cpp-emitter.ts   : C++ emission logic and platform-specific codegen
  - packages/transpiler/src/config-loader.ts      : typehal.config.ts loading and board/package config
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
   - `loadTypehalConfig()` from `packages/transpiler/src/config-loader.ts` reads `typehal.config.ts`.
   - Config values override CLI-supplied flags for board package, fqbn, target, outDir, framework, and console settings.
   - `generateVirtualTypeDeclaration()` is used to keep editor type resolution aligned with bare `@typehal` imports.

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

9. @typehal/expect support and preprocessing
   - Code that imports `@typehal/expect` is transformed by the preprocessor.
   - `loadExpectPreprocessor()` loads `@typehal/expect/preprocessor` lazily to avoid startup dependency failures.
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
import { ProgramIR } from "./ir/model";
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
import { loadBreakpoints, preprocess as debugPreprocess } from "./debug";
import { generateDeclFromCpp } from "./libdef/cpp-to-decl";

function tryGenerateLibDecl(modulePath: string, file: string): string | undefined {
  try {
    const mod = require("@typehal/framework-arduino");
    return mod.tryGenerateArduinoLibDecl?.(modulePath, file);
  } catch {
    return undefined;
  }
}
import { initProfiler, getProfiler } from "./profiler";
import {
  ResolvedNpmPackage,
  NativeCppModule,
  TranspileGraphResult,
  detectNativeCppModule,
  getNpmPackageInfoForFile,
  isInNodeModules,
  resolveImport,
  isTypehalSDKPath,
} from "./transpile/resolution";
type ExpectPreprocessor = (source: string, fileName?: string) => string;
let expectPreprocess: ExpectPreprocessor | undefined;

function loadExpectPreprocessor(): ExpectPreprocessor | undefined {
  if (expectPreprocess) {
    return expectPreprocess;
  }
  try {
    const mod = require("@typehal/expect/preprocessor");
    expectPreprocess = mod?.preprocess;
    return expectPreprocess;
  } catch {
    return undefined;
  }
}

function cleanOutput(entryDir: string, outDir: string): void {
  const cachePath = path.join(entryDir, ".typehal-cache.json");
  try { if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath); } catch { /* ignore */ }
  try { if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

  

/**
 * Auto-generates .d.ts files for C++ modules that are missing declarations.
 * Also tries to generate declarations for Arduino libraries.
 * Returns list of generated files.
 */
function autoGenerateMissingDecls(
  files: string[],
  errors: string[]
): string[] {
  const generated: string[] = [];
  const processedModules = new Set<string>();
  
  for (const error of errors) {
    const modulePath = extractMissingModulePath(error);
    if (!modulePath || processedModules.has(modulePath)) {
      continue;
    }
    
    processedModules.add(modulePath);
    
    // Try relative C++ module first
    if (modulePath.startsWith(".")) {
      for (const file of files) {
        const cppPath = findCppForModule(file, modulePath);
        if (cppPath) {
          const result = generateDeclFromCpp(cppPath);
          if (result) {
            generated.push(result);
          }
          break;
        }
      }
    } else {
      // Try Arduino library for bare module imports
      for (const file of files) {
        const declPath = tryGenerateLibDecl(modulePath, file);
        if (declPath) {
          generated.push(declPath);
          break;
        }
      }
    }
  }
  
  return generated;
}

/**
 * Resolves an npm package import to a TypeScript source file.
 */

/**
 * Result of type-checking files
 */
interface TypeCheckResult {
  /** Whether all files passed type-checking */
  success: boolean;
  /** Array of formatted error messages */
  errors: string[];
  /** Auto-generated declaration files (for user notification) */
  generatedDecls: string[];
}

/**
 * Extracts module path from "Cannot find module" error messages.
 * Returns the module path (relative or bare module name), undefined otherwise.
 */
function extractMissingModulePath(errorMessage: string): string | undefined {
  // Match: Cannot find module './lib/test' or its corresponding type declarations.
  // Also matches bare module names like 'BH1750'
  const match = errorMessage.match(/Cannot find module '([^']+)' or its corresponding type declarations/);
  return match ? match[1] : undefined;
}

/**
 * Attempts to find a .cpp file for a missing module.
 * Checks both direct path and index patterns.
 */
function findCppForModule(fromFile: string, modulePath: string): string | undefined {
  const basePath = path.resolve(path.dirname(fromFile), modulePath);
  
  const candidates = [
    `${basePath}.cpp`,
    path.join(basePath, "index.cpp"),
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  
  return undefined;
}

/**
 * Type-checks TypeScript files using the TypeScript compiler.
 * Returns early if any errors are found.
 * 
 * @param files List of TypeScript files to type-check
 * @param boardPackage Optional board package for resolving @typehal imports
 * @returns TypeCheckResult with success status and any error messages
 */
function typeCheckFiles(
  files: string[],
  boardPackage?: string,
  entryFile?: string,
): TypeCheckResult {
  // Find the nearest tsconfig.json by walking up from the entry file (preferred)
  // or the first file in the graph. Using the entry file ensures we pick up the
  // user's tsconfig (with path mappings) rather than a dependency's tsconfig.
  let configPath: string | undefined;
  let currentDir = path.dirname(entryFile ?? files[0]);
  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  // Read compiler options from tsconfig.json if found
  let compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  let rootNames = [...files];

  if (configPath) {
    const configResult = ts.readConfigFile(configPath, (path) => fs.readFileSync(path, "utf8"));
    if (!configResult.error) {
      const parsedConfig = ts.parseJsonConfigFileContent(
        configResult.config,
        ts.sys,
        path.dirname(configPath),
      );
      if (!parsedConfig.errors.length) {
        compilerOptions = { ...parsedConfig.options, noEmit: true };
      }
    }
  }

  // Create a TypeScript program with the transpile graph files, using compiler options from tsconfig
  const program = ts.createProgram(rootNames, compilerOptions);

  // Collect all diagnostics
  const allDiagnostics: ts.Diagnostic[] = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  // Filter to only errors (ignore suggestions and hints)
  // Also skip errors from files in node_modules or packages directories (not user code)
  const errors = allDiagnostics.filter(d => {
    if (d.category !== ts.DiagnosticCategory.Error) {
      return false;
    }
    // Include errors without a file (global errors)
    if (!d.file) {
      return true;
    }
    const filePath = d.file.fileName.replace(/\\/g, "/");
    // Skip errors from node_modules and internal packages
    if (filePath.includes("/node_modules/") || filePath.includes("/packages/")) {
      return false;
    }
    return true;
  });

  if (errors.length === 0) {
    return { success: true, errors: [], generatedDecls: [] };
  }

  // Format error messages
  const formattedErrors: string[] = [];
  for (const error of errors) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    if (error.file && error.start !== undefined) {
      const { line, character } = error.file.getLineAndCharacterOfPosition(error.start);
      const relativePath = path.relative(process.cwd(), error.file.fileName);
      formattedErrors.push(`${relativePath}(${line + 1}:${character + 1}): ${message}`);
    } else {
      formattedErrors.push(message);
    }
  }

  return { success: false, errors: formattedErrors, generatedDecls: [] };
}

/**
 * Sort files in dependency order using Kahn's algorithm.
 * Dependencies come before dependents so that include ordering is correct
 * (e.g., if A imports B, B appears before A in the result).
 *
 * Falls back to the original order for any files involved in dependency cycles.
 */
function topologicalSortFiles(
  files: string[],
  dependencies: Map<string, Set<string>>,
): string[] {
  if (files.length <= 1) return [...files];

  const fileSet = new Set(files);

  // Build reverse adjacency list: dep → Set<files that depend on dep>
  const dependents = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const f of files) {
    dependents.set(f, new Set());
    inDegree.set(f, 0);
  }

  for (const [file, deps] of dependencies) {
    if (!fileSet.has(file)) continue;
    for (const dep of deps) {
      if (fileSet.has(dep) && dep !== file) {
        dependents.get(dep)!.add(file);
        inDegree.set(file, (inDegree.get(file) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm: start with files that have no in-edges
  const queue: string[] = [];
  for (const f of files) {
    if (inDegree.get(f) === 0) {
      queue.push(f);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    sorted.push(file);
    for (const dependent of dependents.get(file) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If there are cycles, append remaining files in original order
  if (sorted.length < files.length) {
    const sortedSet = new Set(sorted);
    for (const f of files) {
      if (!sortedSet.has(f)) sorted.push(f);
    }
  }

  return sorted;
}

/**
 * Collects all files that need to be transpiled, following both relative and npm imports.
 * Also detects native C++ modules (.d.ts + .cpp pairs).
 * Files are returned in dependency order (dependencies before dependents).
 *
 * @param boardPackage  When provided, bare `@typehal` imports resolve to this
 *                      board package (e.g. `'@typehal/board-arduino-uno'`).
 */
function collectTranspileGraph(entryFile: string, boardPackage?: string): TranspileGraphResult {
  const ordered: string[] = [];
  const pending: string[] = [path.resolve(entryFile)];
  const visited = new Set<string>();
  const npmPackages = new Map<string, ResolvedNpmPackage>();
  const nativeModules = new Map<string, NativeCppModule>();
  // Track dependency edges for topological sorting
  const dependencies = new Map<string, Set<string>>();

  while (pending.length > 0) {
    const filePath = pending.shift();
    if (!filePath || visited.has(filePath)) {
      continue;
    }

    visited.add(filePath);

    // Skip typehal SDK files — they are type-level definitions only
    if (isTypehalSDKPath(filePath)) {
      continue;
    }

    ordered.push(filePath);
    const fileDeps = new Set<string>();
    dependencies.set(filePath, fileDeps);

    const sourceText = readText(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      let moduleSpecifier: string | undefined;

      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        moduleSpecifier = statement.moduleSpecifier.text;
      }

      if (!moduleSpecifier) {
        continue;
      }

      // Check for native C++ module (.d.ts + .cpp pair)
      const nativeModule = detectNativeCppModule(filePath, moduleSpecifier);
      if (nativeModule) {
        nativeModules.set(moduleSpecifier, nativeModule);
        continue; // Don't try to resolve as TypeScript
      }

      // Skip @typehal/expect — it provides type-level stubs only.
      // The AST preprocessor rewrites all expect calls before transpilation.
      if (moduleSpecifier === "@typehal/expect") {
        continue;
      }

      const resolved = resolveImport(filePath, moduleSpecifier, boardPackage);
      if (resolved) {
        // Track dependency edge for topological sorting
        fileDeps.add(resolved.sourcePath);

        if (!visited.has(resolved.sourcePath)) {
          pending.push(resolved.sourcePath);
          if (resolved.npmPackage) {
            npmPackages.set(resolved.sourcePath, resolved.npmPackage);
          } else if (isInNodeModules(resolved.sourcePath)) {
            // If the file is in node_modules but wasn't resolved as an npm package,
            // it was reached via relative import from another npm package file.
            // Create npm package info for it.
            const npmInfo = getNpmPackageInfoForFile(resolved.sourcePath, moduleSpecifier);
            if (npmInfo) {
              npmPackages.set(resolved.sourcePath, npmInfo);
            }
          }
        }
      }
    }
  }

  // Sort files in dependency order (dependencies before dependents)
  const sorted = topologicalSortFiles(ordered, dependencies);
  return { files: sorted, npmPackages, nativeModules };
}

/**
 * Apply tree-shaking to program IR if enabled
 */
function applyTreeShaking(
  programIR: ProgramIR,
  target: TranspileOptions["target"],
  treeShakingOptions?: TreeShakingOptions
): ProgramIR {
  // Default to enabled - tree-shaking removes unreachable code
  const enabled = treeShakingOptions?.enabled !== false;

  if (!enabled) {
    return programIR;
  }

  const profiler = getProfiler();

  // Build call graph
  profiler.startTimer("tree-shake:call-graph");
  const callGraph = buildCallGraph(programIR);
  profiler.endTimer("tree-shake:call-graph");

  // Detect entry points
  profiler.startTimer("tree-shake:entry-points");
  const entryPoints = detectEntryPoints(programIR, target, {
    customEntryPoints: treeShakingOptions?.entryPoints ?? [],
  });
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

  return result;
}

import type { PlatformStrategy } from "./platform/platform-strategy";
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
    enabled: false,
    trackMemory: false,
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
  const outDir = path.join(outBaseDir, options.target === "arduino" ? sketchBaseName : ".build");

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

    // If the file imports @typehal/expect, run the AST preprocessor
    // to rewrite describe/it/expect/done calls into Serial protocol statements.
    if (sourceText.includes("@typehal/expect")) {
      const preprocess = loadExpectPreprocessor();
      if (!preprocess) {
        throw new Error(
          "The @typehal/expect package is required to transpile files that import @typehal/expect. " +
          "Install @typehal/expect or remove the import."
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
    let programIR: ProgramIR;
    if (filePath === entryFile) {
      programIR = applyTreeShaking(rawIR, options.target, {
        ...options.treeShaking,
        keepUnusedVariables: true,
        // Merge exported entry points so cross-module imports aren't shaken out
        entryPoints: [
          ...(options.treeShaking?.entryPoints ?? []),
          ...exportedEntryPoints,
        ],
      });
    } else {
      programIR = applyTreeShaking(rawIR, options.target, {
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
  const allEnumIRs: { name: string; members: { name: string; value?: number }[] }[] = [];
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
    // Only pass strategy if loaded from a package - otherwise let emitCpp resolve from target
    if (boardStrategy) {
      emitOptions.strategy = boardStrategy;
    }
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
