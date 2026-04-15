import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { buildProgramIR } from "./ir/build-ir";
import { emitCpp, registerAllEnumNames } from "./emit/cpp-emitter";
import { GenerateLibdefOptions, GeneratedOutputs, TranspileOptions, TreeShakingOptions } from "./types";
import { readText } from "./utils/fs";
import { loadLibraryDefinitions, generateLibdefStubs } from "./libdef/registry";
import { createPolyfillRegistry, PolyfillContext } from "./polyfill";
import { ProgramIR } from "./ir/model";
import { buildCallGraph } from "./ir/call-graph";
import { collectUsedIdentifiers } from "./ir/identifier-collector";
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
  type FileChangeStatus,
} from "./incremental-cache";
import { detectEntryPoints, detectExportedEntryPoints } from "./ir/entry-points";
import { analyzeReachability } from "./ir/reachability";
import { filterProgramIR } from "./ir/filter";
import { flattenGeneratedModulesIntoSketch } from "./platform/arduino-compile";
import { loadBreakpoints, preprocess as debugPreprocess } from "./debug";
import { generateDeclFromCpp } from "./libdef/cpp-to-decl";
import { tryGenerateArduinoLibDecl } from "./arduino-libs";
import { initProfiler, getProfiler } from "./profiler";

function cleanStaleArduinoOutputs(outDir: string, currentBaseName: string): void {
  if (!fs.existsSync(outDir)) {
    return;
  }

  for (const fileName of fs.readdirSync(outDir)) {
    const fullPath = path.join(outDir, fileName);
    const lower = fileName.toLowerCase();
    const isSourceArtifact = lower.endsWith(".ino") || lower.endsWith(".cpp") || lower.endsWith(".h");
    const isMapArtifact = lower.endsWith(".tscppmap.json");
    if (!isSourceArtifact && !isMapArtifact) {
      continue;
    }

    const artifactBase = lower.endsWith(".tscppmap.json")
      ? path.basename(fileName.slice(0, -".tscppmap.json".length)).replace(/\.[^.]+$/, "")
      : path.basename(fileName).replace(/\.[^.]+$/, "");

    const isCurrentSketch = artifactBase === currentBaseName && (lower.endsWith(".ino") || lower.endsWith(".ino.tscppmap.json"));
    if (isCurrentSketch) {
      continue;
    }

    try {
      fs.unlinkSync(fullPath);
    } catch {
      // Ignore cleanup failures and continue with transpilation.
    }
  }
}

function resolveLocalImport(fromFile: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  // Handle .js extensions in imports (TypeScript ESM pattern: import from "./foo.js")
  // Map .js to .ts source files
  let normalizedSpecifier = moduleSpecifier;
  if (normalizedSpecifier.endsWith(".js")) {
    normalizedSpecifier = normalizedSpecifier.slice(0, -3) + ".ts";
  } else if (normalizedSpecifier.endsWith(".mjs")) {
    normalizedSpecifier = normalizedSpecifier.slice(0, -5) + ".ts";
  }

  const basePath = path.resolve(path.dirname(fromFile), normalizedSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }

    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".ts" || extension === ".tsx") {
      return path.resolve(candidate);
    }
  }

  return undefined;
}

/**
 * Information about a resolved npm package import
 */
export interface ResolvedNpmPackage {
  /** Path to the package directory (e.g., node_modules/typecode-implementation) */
  packagePath: string;
  /** Resolved TypeScript source file path */
  sourcePath: string;
  /** The subpath being imported (e.g., "board-arduino-uno") */
  subpath: string;
  /** The package name (e.g., "typecode-implementation") */
  packageName: string;
  /** Module key for header generation (e.g., "board-arduino-uno") */
  moduleKey: string;
}

/**
 * Parses an npm module specifier into package name and subpath.
 * Handles scoped packages like @scope/package/subpath
 */
function parseModuleSpecifier(moduleSpecifier: string): { packageName: string; subpath: string } {
  const parts = moduleSpecifier.split("/");
  
  if (moduleSpecifier.startsWith("@")) {
    // Scoped package: @scope/package/subpath
    const scope = parts[0];
    const packageName = parts.length > 1 ? `${scope}/${parts[1]}` : scope;
    const subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
    return { packageName, subpath };
  } else {
    // Regular package: package/subpath
    const packageName = parts[0];
    const subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
    return { packageName, subpath };
  }
}

/**
 * Finds the node_modules directory containing the package by walking up the directory tree
 */
function findNodeModulesPackage(
  fromFile: string,
  packageName: string
): string | undefined {
  let currentDir = path.dirname(path.resolve(fromFile));
  
  while (currentDir !== path.dirname(currentDir)) {
    const packageDir = path.join(currentDir, "node_modules", packageName);
    if (fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory()) {
      return packageDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  // Check root level
  const rootPackageDir = path.join(currentDir, "node_modules", packageName);
  if (fs.existsSync(rootPackageDir) && fs.statSync(rootPackageDir).isDirectory()) {
    return rootPackageDir;
  }
  
  return undefined;
}

/**
 * Reads and parses package.json, returning null if not found or invalid
 */
function readPackageJson(packageDir: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  
  try {
    const content = readText(packageJsonPath);
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolves a subpath using the package.json exports field
 */
function resolvePackageExports(
  packageDir: string,
  subpath: string,
  packageJson: Record<string, unknown>
): string | undefined {
  const exports = packageJson["exports"];
  
  if (!exports || typeof exports !== "object") {
    return undefined;
  }
  
  // Try to match the subpath against exports
  const exportKey = subpath ? `./${subpath}` : ".";
  const exportsObj = exports as Record<string, unknown>;
  
  // Look for direct match
  let exportTarget = exportsObj[exportKey];
  
  // Handle conditional exports (e.g., { "import": "...", "types": "..." })
  if (exportTarget && typeof exportTarget === "object") {
    const conditional = exportTarget as Record<string, unknown>;
    // Prefer types, then import, then default
    exportTarget = conditional["types"] ?? conditional["import"] ?? conditional["default"];
  }
  
  if (typeof exportTarget !== "string") {
    return undefined;
  }
  
  // Map dist path to source path
  return mapDistToSource(packageDir, exportTarget, subpath);
}

/**
 * Maps a dist path from package.json to the actual TypeScript source
 */
function mapDistToSource(packageDir: string, distPath: string, subpath: string): string | undefined {
  // Remove ./ prefix if present
  const relativePath = distPath.startsWith("./") ? distPath.slice(2) : distPath;
  
  // Common patterns for mapping dist to source:
  // 1. dist/package/src/index.js -> packages/package/src/index.ts
  // 2. dist/src/index.js -> src/index.ts
  // 3. dist/index.js -> src/index.ts or index.ts
  
  let sourcePath: string | undefined;
  
  // Pattern: dist/packages/*/src/*.js -> packages/*/src/*.ts
  const packagesMatch = relativePath.match(/^dist\/(packages\/[^/]+\/src\/.+)\.js$/);
  if (packagesMatch) {
    sourcePath = path.join(packageDir, packagesMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }
  
  // Pattern: dist/src/*.js -> src/*.ts
  const distSrcMatch = relativePath.match(/^dist\/(src\/.+)\.js$/);
  if (distSrcMatch) {
    sourcePath = path.join(packageDir, distSrcMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }
  
  // Pattern: dist/*.js -> src/*.ts
  const distMatch = relativePath.match(/^dist\/(.+)\.js$/);
  if (distMatch) {
    // Try src/ first
    sourcePath = path.join(packageDir, "src", distMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
    // Try direct
    sourcePath = path.join(packageDir, distMatch[1] + ".ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }
  
  // Fallback: try common source locations based on subpath
  const subpathPrefix = subpath ? `${subpath}/` : "";
  
  // Try packages/subpath/src/index.ts (monorepo pattern)
  if (subpath) {
    sourcePath = path.join(packageDir, "packages", subpath, "src", "index.ts");
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }
  
  // Try src/subpath/index.ts
  sourcePath = path.join(packageDir, "src", subpathPrefix, "index.ts");
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }
  
  // Try subpath/index.ts
  sourcePath = path.join(packageDir, subpathPrefix, "index.ts");
  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }
  
  return undefined;
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
        const declPath = tryGenerateArduinoLibDecl(modulePath, file);
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
function resolveNpmPackageImport(
  fromFile: string,
  moduleSpecifier: string
): ResolvedNpmPackage | undefined {
  const { packageName, subpath } = parseModuleSpecifier(moduleSpecifier);
  
  // Find the package directory
  const packageDir = findNodeModulesPackage(fromFile, packageName);
  if (!packageDir) {
    return undefined;
  }

  // Read package.json
  const packageJson = readPackageJson(packageDir);
  if (!packageJson) {
    return undefined;
  }

  // Try to resolve via exports field first
  let sourcePath = packageJson 
    ? resolvePackageExports(packageDir, subpath, packageJson) 
    : undefined;
  
  // Fallback: try common patterns
  if (!sourcePath) {
    // Try packages/subpath/src/index.ts (monorepo pattern)
    if (subpath) {
      sourcePath = path.join(packageDir, "packages", subpath, "src", "index.ts");
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      // Try src/index.ts
      sourcePath = path.join(packageDir, "src", "index.ts");
    }
    if (!fs.existsSync(sourcePath)) {
      // Try index.ts
      sourcePath = path.join(packageDir, "index.ts");
    }
    if (!fs.existsSync(sourcePath)) {
      sourcePath = undefined;
    }
  }
  
  if (!sourcePath) {
    return undefined;
  }
  
  // Generate module key for header naming
  // Strip .js/.mjs extension if present (TypeScript ESM pattern)
  let moduleKey = subpath || packageName.split("/").pop() || packageName;
  if (moduleKey.endsWith(".js")) {
    moduleKey = moduleKey.slice(0, -3);
  } else if (moduleKey.endsWith(".mjs")) {
    moduleKey = moduleKey.slice(0, -4);
  }
  
  return {
    packagePath: packageDir,
    sourcePath: path.resolve(sourcePath),
    subpath,
    packageName,
    moduleKey,
  };
}

/**
 * Resolves any import (relative or npm) to a TypeScript source file.
 *
 * When `boardPackage` is provided (from typecode.config.ts), a bare
 * `@typecode` import is rewritten to the concrete board package before
 * resolution proceeds.
 */
function resolveImport(
  fromFile: string,
  moduleSpecifier: string,
  boardPackage?: string,
): { sourcePath: string; npmPackage?: ResolvedNpmPackage } | undefined {
  // Rewrite bare "@typecode" virtual import to the concrete board package
  let effectiveSpecifier = moduleSpecifier;
  if (moduleSpecifier === "@typecode" && boardPackage) {
    effectiveSpecifier = boardPackage;
  }

  // Try relative import first
  const localResolved = resolveLocalImport(fromFile, effectiveSpecifier);
  if (localResolved) {
    return { sourcePath: localResolved };
  }
  
  // Try npm package import
  const npmResolved = resolveNpmPackageImport(fromFile, effectiveSpecifier);
  if (npmResolved) {
    return { sourcePath: npmResolved.sourcePath, npmPackage: npmResolved };
  }
  
  return undefined;
}

/**
 * Checks if a file path is within a node_modules directory
 */
function isInNodeModules(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return normalized.includes("/node_modules/");
}

/**
 * Gets the npm package info for a file that's already been resolved
 * (used for files within node_modules that were reached via relative imports)
 */
function getNpmPackageInfoForFile(
  filePath: string,
  moduleSpecifier: string
): ResolvedNpmPackage | undefined {
  if (!isInNodeModules(filePath)) {
    return undefined;
  }
  
  // Parse the module specifier
  const parts = moduleSpecifier.split("/");
  let packageName: string;
  let subpath: string;
  
  if (moduleSpecifier.startsWith("@")) {
    packageName = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
  } else {
    packageName = parts[0];
    subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  }
  
  // Extract module key from the file path
  // For workspace packages like @typecode/core, use "core" as the module key
  // Strip .js/.mjs extension if present (TypeScript ESM pattern)
  let moduleKey = subpath || packageName.split("/").pop() || packageName;
  if (moduleKey.endsWith(".js")) {
    moduleKey = moduleKey.slice(0, -3);
  } else if (moduleKey.endsWith(".mjs")) {
    moduleKey = moduleKey.slice(0, -4);
  }
  
  // Find the package directory by walking up from the file
  let packageDir = path.dirname(filePath);
  while (packageDir !== path.dirname(packageDir)) {
    const packageJsonPath = path.join(packageDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      break;
    }
    packageDir = path.dirname(packageDir);
  }
  
  return {
    packagePath: packageDir,
    sourcePath: path.resolve(filePath),
    subpath,
    packageName,
    moduleKey,
  };
}

/**
 * Information about a native C++ module
 */
export interface NativeCppModule {
  /** Path to the .d.ts declaration file */
  declPath: string;
  /** Path to the .cpp implementation file */
  cppPath: string;
  /** Path to the .h header file (if exists) */
  headerPath?: string;
  /** Module key for naming (derived from file name) */
  moduleKey: string;
}

/**
 * Result of collecting the transpile graph
 */
export interface TranspileGraphResult {
  /** Ordered list of files to transpile */
  files: string[];
  /** Map of source file paths to their npm package info (if from npm) */
  npmPackages: Map<string, ResolvedNpmPackage>;
  /** Map of import specifiers to native C++ modules */
  nativeModules: Map<string, NativeCppModule>;
}

/**
 * Detects a native C++ module: a .d.ts declaration file with a corresponding .cpp implementation.
 * Returns undefined if not a native module.
 */
function detectNativeCppModule(
  fromFile: string,
  moduleSpecifier: string
): NativeCppModule | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  
  // Check for .d.ts + .cpp pair
  const declCandidates = [
    `${basePath}.d.ts`,
    path.join(basePath, "index.d.ts"),
  ];
  
  for (const declPath of declCandidates) {
    if (!fs.existsSync(declPath) || !fs.statSync(declPath).isFile()) {
      continue;
    }
    
    // Found .d.ts, check for corresponding .cpp
    const cppPath = declPath.replace(/\.d\.ts$/i, ".cpp");
    if (fs.existsSync(cppPath) && fs.statSync(cppPath).isFile()) {
      const moduleKey = path.basename(declPath, ".d.ts");
      
      // Check for corresponding .h header file
      const headerPath = declPath.replace(/\.d\.ts$/i, ".h");
      const headerExists = fs.existsSync(headerPath) && fs.statSync(headerPath).isFile();
      
      return {
        declPath: path.resolve(declPath),
        cppPath: path.resolve(cppPath),
        headerPath: headerExists ? path.resolve(headerPath) : undefined,
        moduleKey,
      };
    }
  }
  
  return undefined;
}

/**
 * Checks whether a resolved file path belongs to the typecode SDK
 * (i.e. lives under a `code/core/` or `code/board-*` directory).
 * These files are type-level definitions only and must NOT be transpiled to C++.
 */
function isTypecodeSDKPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  // Match @typecode/core and @typecode/board-* in both flat (node_modules)
  // and monorepo (packages/) layouts.
  return (
    /\/code\/core\//.test(normalized) ||
    /\/code\/board-/.test(normalized) ||
    /\/packages\/board-/.test(normalized) ||
    /\/node_modules\/@typecode\/board-/.test(normalized) ||
    /\/node_modules\/@typecode\/core\//.test(normalized)
  );
}

/**
 * Result of type-checking files
 */
export interface TypeCheckResult {
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
 * @param boardPackage Optional board package for resolving @typecode imports
 * @returns TypeCheckResult with success status and any error messages
 */
function typeCheckFiles(
  files: string[],
  boardPackage?: string,
): TypeCheckResult {
  // Find the nearest tsconfig.json by walking up from the first file
  let configPath: string | undefined;
  let currentDir = path.dirname(files[0]);
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
        rootNames = Array.from(new Set([...parsedConfig.fileNames, ...files]));
      }
    }
  }

  // Create a TypeScript program with all files from tsconfig plus the requested entries
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
 * @param boardPackage  When provided, bare `@typecode` imports resolve to this
 *                      board package (e.g. `'@typecode/board-arduino-uno'`).
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

    // Skip typecode SDK files — they are type-level definitions only
    if (isTypecodeSDKPath(filePath)) {
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
import { ArduinoStrategy } from "./platform/arduino-strategy";

/**
 * Try to load a PlatformStrategy from a framework package.
 * Returns undefined if the package doesn't export a FrameworkStrategy.
 * 
 * @param packageName The package name to load
 * @param fromDir The directory to resolve from (usually the input file's directory)
 * @param debug Enable debug logging
 */
function loadPackageStrategy(packageName: string | undefined, fromDir: string, debug?: boolean): PlatformStrategy | undefined {
  if (!packageName) return undefined;
  
  try {
    // Resolve from the input file's directory to handle monorepo workspaces
    const packagePath = require.resolve(packageName, { paths: [fromDir] });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(packagePath);
    if (pkg.FrameworkStrategy) {
      if (debug) {
        console.log(`Loaded FrameworkStrategy from ${packageName}`);
      }
      return new pkg.FrameworkStrategy();
    }
    if (debug) {
      console.log(`Package ${packageName} has no FrameworkStrategy export`);
    }
  } catch (e) {
    // Package may not have a strategy or may not be installed
    if (debug) {
      console.log(`Failed to load strategy from ${packageName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return undefined;
}

/**
 * Load the appropriate platform strategy based on config.
 * Loads strategy from the framework package if provided.
 * Returns undefined to fall back to target-based resolution via the registry.
 * 
 * @param frameworkPackage The framework package name (e.g., '@typecode/framework-avr')
 * @param boardPackage The board package name (used for import resolution, not strategy loading)
 * @param fromDir The directory to resolve packages from (usually the input file's directory)
 * @returns PlatformStrategy if loaded from a framework package, undefined otherwise
 */
function loadPlatformStrategy(
  frameworkPackage: string | undefined,
  boardPackage: string | undefined,
  fromDir: string,
  debug?: boolean,
): PlatformStrategy | undefined {
  // Load strategy from framework package
  if (frameworkPackage) {
    const strategy = loadPackageStrategy(frameworkPackage, fromDir, debug);
    if (strategy) return strategy;
  }
  
  // Return undefined to let emitCpp resolve based on target option
  if (debug) {
    console.log(`No framework strategy loaded, will use target-based resolution`);
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

  // Initialize incremental cache (always enabled unless force is set)
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
    let typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage);

    // If type-checking failed, try to auto-generate missing .d.ts files from C++ sources
    if (!typeCheckResult.success) {
      profiler.startTimer("typecheck:autogen-decls");
      const generatedDecls = autoGenerateMissingDecls(transpileFiles, typeCheckResult.errors);
      profiler.endTimer("typecheck:autogen-decls");

      // If we generated any declaration files, retry type-checking
      if (generatedDecls.length > 0) {
        profiler.startTimer("typecheck:retry");
        typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage);
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
  const sourceDir = path.dirname(entryFile);
  const sketchBaseName = path.basename(entryFile).replace(/\.[^.]+$/, "");
  const outBaseDir = options.outDir ?? sourceDir;
  const outDir = path.join(outBaseDir, options.target === "arduino" ? sketchBaseName : ".build");
  const currentBaseName = options.target === "arduino"
    ? path.basename(outDir)
    : sketchBaseName;

  if (options.target === "arduino") {
    cleanStaleArduinoOutputs(outDir, currentBaseName);
  }

  const definitions = loadLibraryDefinitions(sourceDir);
  const polyfillRegistry = createPolyfillRegistry();

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
    polyfills: ReturnType<typeof polyfillRegistry.detectAndGenerate>;
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
      console.log(`Incremental: skipping ${skipped} unchanged file(s)`);
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

    profiler.startTimer(`polyfill:${fileBasename}`);
    const polyfillContext: PolyfillContext = {
      target: options.target,
      architecture: options.platformContext?.arduino?.fqbn?.split(":")[1]?.toLowerCase(),
      usedIdentifiers: collectUsedIdentifiers(programIR),
      config: {
        console: {
          enabled: true,
          target: "auto",
          useFlashStrings: true,
          baudRate: options.platformContext?.console?.baudRate ?? 9600,
          autoInjectSerialBegin: true,
        },
      },
    };
    const polyfills = polyfillRegistry.detectAndGenerate(programIR, polyfillContext);
    profiler.endTimer(`polyfill:${fileBasename}`);

    preBuiltArray.push({ filePath, programIR, polyfills, npmPackage });
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
  for (const [filePath, { programIR, polyfills, npmPackage }] of preBuilt) {
    const fileBasename = path.basename(filePath);
    profiler.startTimer(`emit:file:${fileBasename}`);

    const emitOptions: Parameters<typeof emitCpp>[1] = {
      outDir,
      emitMode: options.emitMode,
      target: options.target,
      libdefs: definitions,
      emitMaps: options.emitMaps,
      platformContext: options.platformContext,
      polyfills,
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
      const sourceMapPath = cachedEntryOutputs.find(p => p.endsWith(".cpp.map") || p.endsWith(".ino.tscppmap.json"));
      const headerMapPath = cachedEntryOutputs.find(p => p.endsWith(".h.map"));
      
      if (sourcePath) {
        // Log that we're using cached outputs
        if (options.debug) {
          console.log(`Incremental: all files unchanged, using cached outputs`);
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

    console.log(`Copied native module: ${outputCppPath}`);
  }
  profiler.endTimer("post:native-modules");

  profiler.startTimer("post:flatten");
  if (options.target === "arduino") {
    try {
      flattenGeneratedModulesIntoSketch(path.dirname(entryOutputs.sourcePath), entryOutputs.sourcePath);
    } catch {
      // Best-effort flattening for direct arduino-cli sketch compilation.
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
