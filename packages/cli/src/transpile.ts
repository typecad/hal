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
import { detectEntryPoints } from "./ir/entry-points";
import { analyzeReachability } from "./ir/reachability";
import { filterProgramIR } from "./ir/filter";
import { flattenGeneratedModulesIntoSketch } from "./platform/arduino-compile";
import { loadBreakpoints, preprocess as debugPreprocess } from "./debug";
import { generateDeclFromCpp } from "./libdef/cpp-to-decl";
import { tryGenerateArduinoLibDecl } from "./arduino-libs";

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

  // Create a TypeScript program with all files to check
  const program = ts.createProgram(files, compilerOptions);

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
 * Collects all files that need to be transpiled, following both relative and npm imports.
 * Also detects native C++ modules (.d.ts + .cpp pairs).
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
      if (resolved && !visited.has(resolved.sourcePath)) {
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

  return { files: ordered, npmPackages, nativeModules };
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

  // Build call graph
  const callGraph = buildCallGraph(programIR);

  // Detect entry points
  const entryPoints = detectEntryPoints(programIR, target, {
    customEntryPoints: treeShakingOptions?.entryPoints ?? [],
  });

  // Analyze reachability
  const reachability = analyzeReachability(programIR, callGraph, {
    target,
    keepUnusedEnums: treeShakingOptions?.keepUnusedEnums,
    keepUnusedClasses: treeShakingOptions?.keepUnusedClasses,
    keepUnusedTypeAliases: treeShakingOptions?.keepUnusedTypeAliases,
    keepUnusedVariables: treeShakingOptions?.keepUnusedVariables,
    reportUnused: treeShakingOptions?.reportUnused,
  });

  // Filter program IR
  return filterProgramIR(programIR, reachability, {
    enabled: true,
    keepUnusedEnums: treeShakingOptions?.keepUnusedEnums,
    keepUnusedClasses: treeShakingOptions?.keepUnusedClasses,
    keepUnusedTypeAliases: treeShakingOptions?.keepUnusedTypeAliases,
    keepUnusedVariables: treeShakingOptions?.keepUnusedVariables,
    reportUnused: treeShakingOptions?.reportUnused,
  });
}

import type { PlatformStrategy } from "./platform/platform-strategy";
import { ArduinoStrategy } from "./platform/arduino-strategy";

/**
 * Try to load a PlatformStrategy from a package (board or framework).
 * Checks for FrameworkStrategy (framework packages) or BoardStrategy (legacy board packages).
 * Returns undefined if the package doesn't export a strategy.
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
    // Prefer FrameworkStrategy (new framework packages) over BoardStrategy (legacy)
    if (pkg.FrameworkStrategy) {
      if (debug) {
        console.log(`Loaded FrameworkStrategy from ${packageName}`);
      }
      return new pkg.FrameworkStrategy();
    }
    if (pkg.BoardStrategy) {
      if (debug) {
        console.log(`Loaded BoardStrategy from ${packageName}`);
      }
      return new pkg.BoardStrategy();
    }
    if (debug) {
      console.log(`Package ${packageName} has no FrameworkStrategy or BoardStrategy export`);
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
 * Priority: framework package > board package > undefined (use target-based resolution)
 * 
 * @param frameworkPackage The framework package name (e.g., '@typecode/framework-avr')
 * @param boardPackage The board package name (e.g., '@typecode/board-arduino-uno')
 * @param fromDir The directory to resolve packages from (usually the input file's directory)
 * @returns PlatformStrategy if loaded from a package, undefined otherwise
 */
function loadPlatformStrategy(
  frameworkPackage: string | undefined,
  boardPackage: string | undefined,
  fromDir: string,
  debug?: boolean,
): PlatformStrategy | undefined {
  // Try framework package first (new approach)
  if (frameworkPackage) {
    const strategy = loadPackageStrategy(frameworkPackage, fromDir, debug);
    if (strategy) return strategy;
  }
  
  // Fall back to board package (legacy approach)
  if (boardPackage) {
    const strategy = loadPackageStrategy(boardPackage, fromDir, debug);
    if (strategy) return strategy;
  }
  
  // Return undefined to let emitCpp resolve based on target option
  if (debug) {
    console.log(`No package strategy loaded, will use target-based resolution`);
  }
  return undefined;
}

export async function transpileFile(options: TranspileOptions): Promise<GeneratedOutputs> {
  // Clear session caches at the start of each transpilation
  clearCaches();
  
  const entryFile = path.resolve(options.inputFile);
  const entryDir = path.dirname(entryFile);
  
  // Load platform strategy from framework or board package, or use target-based resolution
  const boardStrategy = loadPlatformStrategy(
    options.frameworkPackage,
    options.boardPackage,
    entryDir,
    options.debug,
  );
  
  const graphResult = collectTranspileGraph(entryFile, options.boardPackage);
  const transpileFiles = graphResult.files;

  // ── Type-check all files before transpiling ────────────────────────────────
  // Skip type-checking if explicitly disabled
  if (options.skipTypeCheck !== true && transpileFiles.length > 0) {
    let typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage);
    
    // If type-checking failed, try to auto-generate missing .d.ts files from C++ sources
    if (!typeCheckResult.success) {
      const generatedDecls = autoGenerateMissingDecls(transpileFiles, typeCheckResult.errors);
      
      // If we generated any declaration files, retry type-checking
      if (generatedDecls.length > 0) {
        typeCheckResult = typeCheckFiles(transpileFiles, options.boardPackage);
      }
    }
    
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

  // Build IR for all files - parallelize file reads for better I/O performance
  // File reading is async, IR building is CPU-bound synchronous
  const buildIRForFile = async (filePath: string): Promise<PreBuiltFile> => {
    // Use async file read for better I/O parallelism
    let sourceText = await fs.promises.readFile(filePath, "utf8");
    
    // Apply debug preprocessing if enabled and breakpoints exist for this file
    if (options.debug && breakpoints) {
      const instrumented = debugPreprocess({
        fileName: filePath,
        breakpoints,
        source: sourceText,
      });
      sourceText = instrumented;
    }
    
    let programIR = buildProgramIR(filePath, sourceText, options.boardPackage);

    // Apply tree-shaking for all files.
    // Keep variables for all files to avoid dropping top-level variable
    // declarations that are referenced in subsequent statements.
    // For non-entry modules, also preserve enums to avoid dropping
    // constants that may be referenced in class default parameters or after lowering.
    if (filePath === entryFile) {
      programIR = applyTreeShaking(programIR, options.target, {
        ...options.treeShaking,
        keepUnusedVariables: true,
      });
    } else {
      programIR = applyTreeShaking(programIR, options.target, {
        enabled: options.treeShaking?.enabled ?? true,
        keepUnusedEnums: true,
        keepUnusedClasses: options.treeShaking?.keepUnusedClasses,
        keepUnusedTypeAliases: options.treeShaking?.keepUnusedTypeAliases,
        reportUnused: options.treeShaking?.reportUnused,
        entryPoints: options.treeShaking?.entryPoints,
        keepUnusedVariables: true,
      });
    }

    const polyfillContext: PolyfillContext = {
      target: options.target,
      // Derive architecture from FQBN (e.g. "arduino:avr:uno" → "avr") so
      // polyfills can gate stdlib-dependent code correctly.
      architecture: options.platformContext?.arduino?.fqbn?.split(":")[1]?.toLowerCase(),
      usedIdentifiers: collectUsedIdentifiers(programIR),
      // Pass console config for baud rate
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
    const npmPackage = npmPackages.get(filePath);

    return { filePath, programIR, polyfills, npmPackage };
  };

  // Process all files in parallel using Promise.all for concurrent file I/O
  // This reads all source files concurrently, then builds IR synchronously
  const preBuiltArray = await Promise.all(transpileFiles.map(buildIRForFile));
  const preBuilt = new Map<string, PreBuiltFile>();
  for (const item of preBuiltArray) {
    preBuilt.set(item.filePath, item);
  }

  // Collect ALL enum IRs from ALL files and register them before emitting.
  // This makes the property-access renderer and struct field type inference
  // aware of every enum type (including its member values for AVR range checks)
  // regardless of which file it's defined in or what order files are emitted.
  const allEnumIRs: { name: string; members: { name: string; value?: number }[] }[] = [];
  for (const { programIR } of preBuilt.values()) {
    for (const e of programIR.enums) {
      allEnumIRs.push(e);
    }
  }
  registerAllEnumNames(allEnumIRs);

  // ── Pass 2: emit ──────────────────────────────────────────────────────────
  for (const [filePath, { programIR, polyfills, npmPackage }] of preBuilt) {
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
  }

  if (!entryOutputs) {
    throw new Error(`Unable to transpile entry file '${entryFile}'.`);
  }

  // ── Copy native C++ modules to output ─────────────────────────────────────
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

  if (options.target === "arduino") {
    try {
      flattenGeneratedModulesIntoSketch(path.dirname(entryOutputs.sourcePath), entryOutputs.sourcePath);
    } catch {
      // Best-effort flattening for direct arduino-cli sketch compilation.
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
