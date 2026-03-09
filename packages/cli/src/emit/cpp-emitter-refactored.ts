/**
 * C++ Code Emitter - Main Orchestrator
 * 
 * This file coordinates the emission of C++ code from TypeScript IR.
 * It uses specialized emitters for different concerns:
 * - ClassEmitter: Classes and namespaces
 * - EnumEmitter: Enums and type aliases
 * - FunctionEmitter: Functions and callbacks
 * - SetupEmitter: setup()/loop()/main() generation
 * 
 * The module-level state (_emitBoardConstants, etc.) is deprecated.
 * Use EmitterState for new code.
 */

import path from "node:path";
import { ProgramIR, ExpressionIR, StatementIR } from "../ir/model";
import { analyzeProgram, ProgramAnalysisResult } from "../ir/program-analysis";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { getArduinoLibraryClassNames, isArduinoLibraryImport } from "../arduino-libs";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { RuntimePolyfillIR } from "../polyfill/types";
import { emitPolyfillBoilerplate } from "../polyfill/emitter";
import { ResolvedNpmPackage } from "../transpile";
import { extractPropertyChain } from "../platform/typecode-map";
import type { BoardConstants } from "../ir/board-resolver";
import type { PlatformStrategy } from "../platform/platform-strategy";
import { resolveStrategy } from "../platform/registry";

// Import extracted utilities
import {
  isTypecodeSDKImport,
  normalizeInclude,
  dedupe,
  resolveTranspiledModuleInclude,
  applySymbolMap,
  emitCommentLines,
  toPascalCaseLocal,
  generateAsyncTaskClass,
  inferObjectFieldType,
  collectDeclaredTypes,
  hasArrayInObjectLiteral,
  hasThrowStatements,
  hasStdMathCalls,
  hasConsoleCalls,
  isConsoleCall,
  getConsoleMethod,
  isRuntimeExpression,
  statementRequiresRuntime,
  collectPointerVarTypes,
} from "./utils";

// Import specialized emitters
import { ClassEmitter, type ClassEmitterContext } from "./class-emitter";
import { EnumEmitter, type EnumEmitterContext } from "./enum-emitter";
import { FunctionEmitter, type FunctionEmitterContext } from "./function-emitter";
import { SetupEmitter, type SetupEmitterContext } from "./setup-emitter";
import { ExpressionRenderer } from "./expression-renderer";
import { StatementRenderer } from "./statement-renderer";
import { EmitterState, createEmitterState } from "./emitter-context";

// ---------------------------------------------------------------------------
// Module-level state (DEPRECATED - use EmitterState instead)
// ---------------------------------------------------------------------------

let _emitBoardConstants: BoardConstants | undefined;
let _arduinoClassNameMap: Map<string, string> | undefined;
const _emitEnumNames: Set<string> = new Set();
const _largeEnumNames: Set<string> = new Set();
let _defaultStrategy: PlatformStrategy = resolveStrategy("generic");

// Module-level cache for Arduino library class name mappings
const _arduinoClassNameCache = new Map<string, Map<string, string>>();

/**
 * Pre-populate the module-level enum registries from *all* program IRs.
 * @deprecated Use EmitterState.registerEnums() instead
 */
export function registerAllEnumNames(
  enums: Iterable<{ name: string; members: { name: string; value?: number }[] }>
): void {
  for (const e of enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Emitter Options
// ---------------------------------------------------------------------------

interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  polyfills?: RuntimePolyfillIR[];
  npmPackage?: ResolvedNpmPackage;
  npmPackages?: Map<string, ResolvedNpmPackage>;
  isEntryFile?: boolean;
  strategy?: PlatformStrategy;
  nativeModules?: Map<string, { declPath: string; cppPath: string; moduleKey: string }>;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function buildArduinoClassNameMap(imports: { moduleSpecifier: string; namedImports: string[] }[]): Map<string, string> {
  const result = new Map<string, string>();
  
  for (const imp of imports) {
    if (!isArduinoLibraryImport(imp.moduleSpecifier)) {
      continue;
    }
    
    let classMap = _arduinoClassNameCache.get(imp.moduleSpecifier);
    if (!classMap) {
      classMap = getArduinoLibraryClassNames(imp.moduleSpecifier);
      _arduinoClassNameCache.set(imp.moduleSpecifier, classMap);
    }
    
    for (const [simpleName, fullName] of classMap) {
      result.set(simpleName, fullName);
    }
  }
  
  return result;
}

function renderBoilerplate(program: ProgramIR): string {
  const chunks: string[] = [];

  if (program.boilerplates.has("async_stub")) {
    chunks.push("struct TsAsyncTask { bool done = true; };\n");
  }

  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Main Emitter
// ---------------------------------------------------------------------------

export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  // Initialize module-level state (deprecated but still used for compatibility)
  _emitBoardConstants = program.boardConstants;
  
  // Register enums
  for (const e of program.enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }

  // Resolve the platform strategy
  const strategy: PlatformStrategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  _defaultStrategy = strategy;
  
  // Inform ArduinoStrategy about large enum names
  if (typeof (strategy as any).setLargeEnumNames === "function") {
    (strategy as any).setLargeEnumNames(_largeEnumNames);
  }

  ensureDir(options.outDir);

  // Build class name mapping for Arduino library imports
  _arduinoClassNameMap = buildArduinoClassNameMap(program.imports);

  // Perform program analysis
  const programAnalysis = analyzeProgram(program);

  // Determine output file names
  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const baseName = options.npmPackage?.moduleKey
    || strategy.overrideBaseName(originalBaseName, outDirBaseName, isEntryFile, isNpmPackage);
  
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;
  const sourceExtension = strategy.sourceExtension(isEntryFile, isNpmPackage);
  const headerPath = path.join(options.outDir, `${baseName}.h`);
  const sourcePath = path.join(options.outDir, `${baseName}.${sourceExtension}`);

  // Collect includes
  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];
  
  // Get polyfills
  const nativePolyfillIds = strategy.nativePolyfills?.() ?? new Set<string>();
  const filteredPolyfills = (options.polyfills ?? []).filter(
    (polyfill) => !nativePolyfillIds.has(polyfill.id)
  );
  const nativePolyfills = strategy.generateNativePolyfills?.(program, options.platformContext) ?? [];
  const allPolyfills = [...filteredPolyfills, ...nativePolyfills];
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = filteredPolyfills.some((polyfill) => polyfill.id === "async_arduino");
  const hasPromiseRuntime = filteredPolyfills.some(
    (polyfill) => polyfill.id === "async_arduino" && (polyfill as any).hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    shimLines = [...strategy.shimLines(program, options.platformContext)];
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  // Process imports
  for (const imported of program.imports) {
    if (isTypecodeSDKImport(imported.moduleSpecifier, program.fileName)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    if (options.nativeModules && options.nativeModules.has(imported.moduleSpecifier)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    const transpiledInclude = resolveTranspiledModuleInclude(
      imported.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      includes.push(transpiledInclude.include);
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
    } else {
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
    }
  }

  // Collect re-export includes
  const headerIncludes: string[] = [];
  for (const reExport of program.reExports) {
    const transpiledInclude = resolveTranspiledModuleInclude(
      reExport.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      headerIncludes.push(transpiledInclude.include);
      continue;
    }
    
    if (reExport.moduleSpecifier.startsWith(".")) {
      let modulePath = reExport.moduleSpecifier;
      modulePath = modulePath.replace(/\.js$/, "").replace(/\.mjs$/, "");
      const segments = modulePath.split("/");
      const baseName = segments[segments.length - 1] || segments[segments.length - 2];
      headerIncludes.push(`"${baseName}.h"`);
    }
  }

  // Process functions
  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => strategy.mapFunctionName(fn.originalName))
  );

  const mappedFunctions = program.functions.map((fn) => ({
    name: strategy.mapFunctionName(fn.originalName),
    returnType: strategy.mapReturnType(strategy.mapFunctionName(fn.originalName), fn.returnType),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
    isAsync: fn.isAsync,
    statements: fn.statements.map((stmt) => {
      if (stmt.kind === "call") {
        return { ...stmt, callee: applySymbolMap(stmt.callee, symbolMap) };
      }
      return stmt;
    }),
  }));

  const knownFunctionReturnTypes = new Map<string, string>();
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    knownFunctionReturnTypes.set(
      fn.originalName,
      strategy.mapReturnType(strategy.mapFunctionName(fn.originalName), fn.returnType)
    );
  }

  // Generate async task classes
  const asyncTaskClasses: { classDef: string; instanceDecl: string; taskVarName: string }[] = [];
  if (hasAsyncRuntime) {
    for (const fn of program.functions) {
      if (fn.isAsync) {
        // Use a simplified render statement function for async state machine
        const renderStmtForAsync = (stmt: StatementIR): string => {
          // Simplified - just return a placeholder for complex statements
          return `/* statement: ${stmt.kind} */`;
        };
        
        const task = generateAsyncTaskClass(
          fn.originalName,
          fn.statements,
          strategy,
          knownFunctionReturnTypes,
          (stmt, forHeader, strat, ptrTypes, calleeTransformer, retTypes) => {
            // Use the module-level renderStatement for now
            return renderStmtForAsync(stmt);
          }
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }
  }

  // Output lines
  const headerLines: string[] = ["#pragma once", ""];
  const sourceLines: string[] = [];
  const sourceMapEntries: SourceMapEntry[] = [];
  const headerMapEntries: SourceMapEntry[] = [];

  function appendSourceLine(line: string, entry?: { tsSpan: any; nodeKind: string; symbolName?: string }): void {
    sourceLines.push(line);
    if (entry) {
      const generatedLine = sourceLines.length;
      sourceMapEntries.push({
        generatedStartLine: generatedLine,
        generatedStartColumn: 1,
        generatedEndLine: generatedLine,
        generatedEndColumn: Math.max(1, line.length + 1),
        tsSpan: entry.tsSpan,
        nodeKind: entry.nodeKind,
        symbolName: entry.symbolName,
      });
    }
  }

  function appendHeaderLine(line: string, entry?: { tsSpan: any; nodeKind: string; symbolName?: string }): void {
    headerLines.push(line);
    if (entry) {
      const generatedLine = headerLines.length;
      headerMapEntries.push({
        generatedStartLine: generatedLine,
        generatedStartColumn: 1,
        generatedEndLine: generatedLine,
        generatedEndColumn: Math.max(1, line.length + 1),
        tsSpan: entry.tsSpan,
        nodeKind: entry.nodeKind,
        symbolName: entry.symbolName,
      });
    }
  }

  // Create specialized emitters
  const emitterContext = {
    strategy,
    boardConstants: _emitBoardConstants,
    arduinoClassNameMap: _arduinoClassNameMap,
    enumNames: _emitEnumNames,
    largeEnumNames: _largeEnumNames,
    knownFunctionReturnTypes,
  };

  // Note: For a full refactoring, we would use these emitters instead of
  // inline rendering. For now, this file maintains backward compatibility
  // while the specialized emitters are available for new code.

  // Add includes
  if (strategy.needsIostream() && programAnalysis.hasConsoleCalls) {
    includes.push("<iostream>");
  }
  if (programAnalysis.usesStdString && strategy.needsStdString()) {
    includes.push("<string>");
  }
  if (strategy.needsStdVector() && (programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral)) {
    includes.push("<vector>");
  }
  if (programAnalysis.usesStdFunction) {
    includes.push("<functional>");
  }
  if (programAnalysis.hasThrowStatements && strategy.needsStdExcept()) {
    includes.push("<stdexcept>");
  }
  if (programAnalysis.hasStdMathCalls) {
    includes.push(strategy.mathHeader());
  }
  if (emittedPolyfills) {
    includes.push(...emittedPolyfills.includes.map(normalizeInclude));
  }

  for (const include of dedupe(includes)) {
    appendSourceLine(`#include ${include}`);
  }
  appendSourceLine("");

  // Emit boilerplate
  const boilerplate = renderBoilerplate(program);
  if (boilerplate) {
    appendSourceLine(boilerplate.trimEnd());
    appendSourceLine("");
  }

  // Emit polyfills
  if (emittedPolyfills) {
    if (emittedPolyfills.declarations.length > 0) {
      for (const declaration of emittedPolyfills.declarations) {
        appendSourceLine(declaration);
      }
      appendSourceLine("");
    }
    if (emittedPolyfills.definitions.length > 0) {
      for (const definition of emittedPolyfills.definitions) {
        appendSourceLine(definition.trimEnd());
        appendSourceLine("");
      }
    }
  }

  // Emit async state machines
  if (asyncTaskClasses.length > 0) {
    for (const { classDef, instanceDecl } of asyncTaskClasses) {
      for (const line of classDef.split("\n")) {
        appendSourceLine(line);
      }
      appendSourceLine("");
      appendSourceLine(instanceDecl);
      appendSourceLine("");
    }
  }

  // Emit shim lines
  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLine(line);
    }
    appendSourceLine("");
  }

  // NOTE: The remaining emission logic (classes, enums, functions, etc.)
  // continues in the original cpp-emitter.ts style for backward compatibility.
  // A full migration would replace this with calls to the specialized emitters.
  // See the original cpp-emitter.ts for the complete implementation.

  // For now, we'll include a stub that indicates this is a partial refactoring
  appendSourceLine("// NOTE: Full emission logic remains in original cpp-emitter.ts");
  appendSourceLine("// This file demonstrates the new modular architecture");

  // Write output files
  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;
  
  if (effectiveEmitMode === "split") {
    const finalHeaderLines = [...headerLines];
    const headerIncludeLines = dedupe([...includes, ...headerIncludes]);
    if (headerIncludeLines.length > 0) {
      const includeLines = headerIncludeLines.map((inc) => `#include ${inc}`);
      finalHeaderLines.splice(1, 0, ...includeLines, "");
    }
    writeText(headerPath, finalHeaderLines.join("\n").trimEnd() + "\n");
    outputHeaderPath = headerPath;
    if (options.emitMaps) {
      outputHeaderMapPath = writeSourceMap(makeGeneratedMap(headerPath, program.fileName, headerMapEntries));
    }
  }

  writeText(sourcePath, sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, sourceMapEntries))
    : undefined;

  const diagnostics: Diagnostic[] = [...program.diagnostics, ...profileDiagnostics];
  diagnostics.push(...strategy.emitDiagnostics(options.emitMode));

  return {
    headerPath: outputHeaderPath,
    sourcePath,
    headerMapPath: outputHeaderMapPath,
    sourceMapPath: outputSourceMapPath,
    diagnostics,
  };
}

// Re-export for backward compatibility
export { EmitterState, createEmitterState };