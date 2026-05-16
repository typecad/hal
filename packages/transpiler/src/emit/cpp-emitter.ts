import path from "node:path";
import type { ProgramIR, ExpressionIR, StatementIR } from "@typehal/core";
import { analyzeProgram, ProgramAnalysisResult } from "../ir/program-analysis";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { escapeCppKeyword } from "../utils/strings";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { RuntimePolyfillIR } from "@typehal/core/shared";
import { emitPolyfillBoilerplate } from "./native-helpers-emitter";
import { filterPolyfillHelpers } from "@typehal/core/shared";
import { ResolvedNpmPackage } from "../transpile/resolution";
import { extractPropertyChain } from "../ir/extract-property-chain";
import type { BoardConstants } from "../ir/board-resolver";
import type { PlatformStrategy } from "@typehal/core/shared";
import { resolveStrategy } from "../platform/registry";
import { getLoadedFramework } from "../framework-registry";
import { buildSnprintfRenderResult, cloneEmissionScopeState, createChildEmissionScope, createEmissionScopeState, type EmissionScopeState, inferSnprintfArg, recordVariableType, statementNeedsSnprintf, shouldUseSnprintfForString } from "./snprintf-helpers";
import { ExpressionRenderer, normalizeRawExpression, transformTypeName } from "./expression-renderer";
import { mapPeripheralName, renderPeripheralProperty } from "../mapping/peripheral-names";
import { accessorGetterName, accessorSetterName } from "./utils/cpp-helpers";
import { StatementRenderer } from "./statement-renderer";
import {
  isTypehalSDKImport,
  emitCommentLines,
  isConsoleCall,
  getConsoleMethod,
  normalizeInclude,
  dedupe,
  applySymbolMap,
  resolveTranspiledModuleInclude,
  generateAsyncTaskClass,
  inferObjectFieldType,
  collectNestedStructDefs,
  isRuntimeExpression,
  statementRequiresRuntime,
  collectPointerVarTypes,
  hasConsoleCalls,
} from "./utils";
import { registeredCallbacks } from "../ir/build-ir-state";

// ---------------------------------------------------------------------------
// Pre-compiled regex patterns for performance
// ---------------------------------------------------------------------------
const PATH_BACKSLASH_PATTERN = /\\/g;
const DOUBLE_QUOTE_PATTERN = /"/g;
const DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
const JS_EXTENSION_PATTERN = /\.js$/;
const MJS_EXTENSION_PATTERN = /\.mjs$/;
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;

// ----------------: -----------------------------------------------------------
// Emit-time context
// ---------------------------------------------------------------------------

const globalEnumNames = new Set<string>();
const globalLargeEnumNames = new Set<string>();

export function registerAllEnumNames(enums: any[]): void {
  for (const e of enums) {
    globalEnumNames.add(e.name);
    if (e.members && e.members.some((m: any) => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      globalLargeEnumNames.add(e.name);
    }
  }
}

function resolveTemplateReturnType(
  returnType: string,
  typeParameters: string[] | undefined,
  templateInterfaceNames: Set<string>,
  interfaceNamespaceMap: Map<string, string>
): string {
  if (!typeParameters || typeParameters.length === 0) return returnType;
  return returnType;
}





interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  /** Info about the npm package being transpiled (if this file is from an npm package) */
  npmPackage?: ResolvedNpmPackage;
  /** Map of all npm packages being transpiled (source path -> package info) */
  npmPackages?: Map<string, ResolvedNpmPackage>;
  /** Whether this is the entry file (main .ino for Arduino) */
  isEntryFile?: boolean;
  /** Override the platform strategy (resolved from target if not provided). */
  strategy?: PlatformStrategy;
  /** Native C++ modules detected during import resolution (module specifier -> info) */
  nativeModules?: Map<string, { declPath: string; cppPath: string; moduleKey: string }>;
  /**
   * Class names defined in other transpiled modules.
   * Used to emit forward declarations in the header so that cross-module
   * type references compile correctly (especially for pointer/reference types).
   */
  crossModuleClasses?: Set<string>;
}






export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  const largeEnumNames = new Set<string>();
  const enumNames = new Set<string>();
  for (const e of program.enums) {
    enumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      largeEnumNames.add(e.name);
    }
  }
  const namespaceNames = new Set<string>();
  // Register namespace-internal enums and namespace names.
  for (const ns of program.namespaces) {
    namespaceNames.add(ns.name);
    for (const e of ns.enums) {
      enumNames.add(e.name);
      if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
        largeEnumNames.add(e.name);
      }
    }
  }

  // Resolve the platform strategy for this target.
  const strategy: PlatformStrategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  // Inform the strategy about large enum names so it can decide on underlying type.
  strategy.setLargeEnumNames?.(largeEnumNames);
  // Capture the strategy's platform-reserved names.
  const platformReservedNames = strategy.reservedNames();

  ensureDir(options.outDir);

  // Build class name mapping for Arduino library imports (for namespace resolution)
  const classNameMap = (() => {
    try {
      const framework = getLoadedFramework();
      if (framework.classNameMapBuilder) {
        return framework.classNameMapBuilder(program.imports);
      }
    } catch {
      // No loaded framework — no class name mapping available.
    }
    return undefined;
  })();

  // Perform single-pass program analysis to replace multiple traversals
  const programAnalysis = analyzeProgram(program, strategy);

  // Make analysis and architecture available to strategy methods via PlatformContext
  if (options.platformContext) {
    options.platformContext.analysis = programAnalysis;
    if (!options.platformContext.architecture && program.boardConstants) {
      options.platformContext.architecture = program.boardConstants.get("architecture") as string;
    }
  }

  // For npm package files, use the moduleKey as the base name
  // For entry files, use the original filename
  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const baseName = options.npmPackage?.moduleKey
    || strategy.overrideBaseName(originalBaseName, outDirBaseName, options.isEntryFile ?? true, !!options.npmPackage);

  // Determine emit mode and extensions
  // For npm packages, always emit .h/.cpp (not .ino)
  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const isrPrefix = isEntryFile ? 'main' : originalBaseName;
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;
  const sourceExtension = strategy.sourceExtension(isEntryFile, isNpmPackage);
  const headerPath = path.join(options.outDir, `${baseName}.h`);
  const sourcePath = path.join(options.outDir, `${baseName}.${sourceExtension}`);

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];

  // Get native helper implementations from the strategy
  // Skip for non-entry files — they're emitted in the entry .ino and shared via includes
  const nativePolyfills = isEntryFile
    ? (strategy.generateNativePolyfills?.(program, options.platformContext) ?? [])
    : [];

  // Filter native polyfill helpers to only those actually used by the program
  let filteredNativePolyfills = filterPolyfillHelpers(nativePolyfills, programAnalysis.usedPolyfillHelpers);
  // typehal_halt is only needed when the program contains throw statements
  if (!programAnalysis.hasThrowStatements) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "typehal_halt");
  }
  // Timer runtime is only needed when the program uses setTimeout/setInterval
  const usesTimers = programAnalysis.usedPolyfillHelpers.has('__tc_setInterval') ||
                     programAnalysis.usedPolyfillHelpers.has('__tc_setTimeout');
  if (!usesTimers) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "timer_methods");
  }

  // Emit native helpers
  const allPolyfills = filteredNativePolyfills;
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = program.functions.some(fn => fn.isAsync);
  // True only when the Promise/MicrotaskQueue runtime was emitted (requires C++ stdlib).
  // On AVR this is false; typehal_pump_microtasks() must NOT be called.
  const hasPromiseRuntime = nativePolyfills.some(
    (p) => p.id === "async_runtime" && (p as any).hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    // Only emit shim lines for the entry file — non-entry files are merged into
    // the entry sketch, so emitting shims there too would cause redefinitions.
    if (isEntryFile) {
      shimLines = [...strategy.shimLines(program, options.platformContext)];
    }
    // Filter shim lines for unused utilities
    if (!programAnalysis.usesStringConversion) {
      shimLines = shimLines.filter(l => !l.includes('std::string String('));
    }
    if (!programAnalysis.usesDateNow) {
      shimLines = shimLines.filter(l => !l.includes('namespace Date'));
    }
    if (!programAnalysis.usesMillis) {
      shimLines = shimLines.filter(l => !l.includes('millis()'));
    }
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  for (const imported of program.imports) {
    // Skip imports from typehal SDK modules — the symbols they export
    // (pin names like A0, D13, LED) are already provided by <Arduino.h>.
    if (isTypehalSDKImport(imported.moduleSpecifier, program.fileName)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    // Skip native C++ modules - they are merged into the output, not included
    if (options.nativeModules && options.nativeModules.has(imported.moduleSpecifier)) {
      // Keep original symbol names for native modules
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    // First check if this import is from a transpiled npm package
    const transpiledInclude = resolveTranspiledModuleInclude(
      imported.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );

    if (transpiledInclude.isTranspiled) {
      includes.push(transpiledInclude.include);
      // Keep original symbol names for transpiled modules
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
    } else {
      // Fall back to libdef resolution
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
    }
  }


  // Collect re-export includes for the header file
  const headerIncludes: string[] = [];
  for (const reExport of program.reExports) {
    // First try npm package resolution
    const transpiledInclude = resolveTranspiledModuleInclude(
      reExport.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );

    if (transpiledInclude.isTranspiled) {
      headerIncludes.push(transpiledInclude.include);
      continue;
    }

    // Handle relative re-exports within npm packages
    // e.g., export * from "./pins.js" in a package index file
    if (reExport.moduleSpecifier.startsWith(".")) {
      // Extract the module name from the relative path
      // Handle paths like "./pins.js", "./subdir/module.js"
      let modulePath = reExport.moduleSpecifier;
      // Remove .js/.mjs extensions
      modulePath = modulePath.replace(/\.js$/, "").replace(/\.mjs$/, "");
      // Get the last segment as the base name
      const segments = modulePath.split("/");
      const baseName = segments[segments.length - 1] || segments[segments.length - 2];
      const headerName = `${baseName}.h`;
      headerIncludes.push(`"${headerName}"`);
    }
  }

  // Pre-scan interfaces to detect template struct names and namespace scopes
  const templateInterfaceNames = new Set<string>();
  const interfaceNamespaceMap = new Map<string, string>();
  for (const iface of program.interfaces) {
    if (iface.parentScope) {
      interfaceNamespaceMap.set(iface.name, iface.parentScope);
    }
    for (const field of iface.fields) {
      if (/^[A-Z]$/.test(field.cppType)) {
        templateInterfaceNames.add(iface.name);
        break;
      }
    }
  }

  const mappedFunctions = program.functions.map((fn) => {
    const fnName = fn.originalName === "__typehal_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
    return {
      name: fnName,
      returnType: resolveTemplateReturnType(
        strategy.mapReturnType(fnName, fn.returnType),
        fn.typeParameters,
        templateInterfaceNames,
        interfaceNamespaceMap,
      ),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
    isAsync: fn.isAsync,
    typeParameters: fn.typeParameters,
    typeParameterConstraints: fn.typeParameterConstraints,
    isReadonlyReturnType: fn.isReadonlyReturnType,
    statements: fn.statements.map((stmt) => {
      if (stmt.kind === "call") {
        return {
          ...stmt,
          callee: applySymbolMap(stmt.callee, symbolMap),
        };
      }

      return stmt;
    }),
  };
});

  const knownFunctionReturnTypes = new Map<string, string>();
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    const fnName = fn.originalName === "__typehal_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
    knownFunctionReturnTypes.set(fn.originalName, strategy.mapReturnType(fnName, fn.returnType));
  }

  // Set up the emission state and renderers
  const snprintfCounter = { value: 0 };
  const topLevelScope = createEmissionScopeState();
  const stringVarNames = new Set<string>();
  const varAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();

  const exprRenderer = new ExpressionRenderer({
    strategy,
    boardConstants: program.boardConstants,
    classNameMap,
    enumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
  });

  const statementRenderer = new StatementRenderer({
    strategy,
    boardConstants: program.boardConstants,
    classNameMap,
    enumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
  });

  // Local helper wrappers to minimize changes to the rest of the function
  const renderExpression = (expr: ExpressionIR, calleeTransformer?: (callee: string) => string) => 
    exprRenderer.render(expr, calleeTransformer);
  
  const renderStatement = (stmt: StatementIR, forHeader: boolean = false, calleeTransformer?: (callee: string) => string) =>
    statementRenderer.render(stmt, forHeader, calleeTransformer);

  const renderTypedName = (cppType: string, name: string, strategy: PlatformStrategy) =>
    statementRenderer.renderTypedName(cppType, name);

  const renderParameters = (params: any[], forHeader: boolean = false) =>
    statementRenderer.renderParameters(params, forHeader);

  const mapFunctionName = (originalName: string, strategy: PlatformStrategy) =>
    statementRenderer.mapFunctionName(originalName);

  const mapReturnType = (fnName: string, tsType: string, strategy: PlatformStrategy) =>
    statementRenderer.mapReturnType(fnName, tsType);

  const normalizeCppTypeForTarget = (cppType: string, strategy: PlatformStrategy) =>
    strategy.normalizeCppType(cppType);

  // Set of original async function names — used to suppress their direct emission
  // and to filter them out of top-level setup() calls.
  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => mapFunctionName(fn.originalName, strategy))
  );

  // Pre-build state machine class strings for every async function.
  // These are emitted into the source file after the polyfill runtime definitions.
  const asyncTaskClasses: { classDef: string; instanceDecl: string; taskVarName: string }[] = [];
  if (hasAsyncRuntime) {
    for (const fn of program.functions) {
      if (fn.isAsync) {
        const task = generateAsyncTaskClass(
          fn.originalName,
          fn.statements,
          strategy,
          knownFunctionReturnTypes,
          (stmt, forHeader, strategy, pointerVarTypes, calleeTransformer, knownReturnTypes) => {
            const contextRenderer = new StatementRenderer({
              strategy,
              boardConstants: program.boardConstants,
              classNameMap,
              enumNames,
              largeEnumNames,
              knownFunctionReturnTypes: knownReturnTypes ?? knownFunctionReturnTypes,
              knownVariableTypes: topLevelScope.knownVariableTypes,
              namespaceNames,
              snprintfCounter,
              stringVarNames,
              varAccessorNames,
              pointerVarTypes,
            });
            return contextRenderer.render(stmt, forHeader, calleeTransformer);
          },
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }
  }

  const headerLines: string[] = ["#pragma once", ""];
  let sourceLines: string[] = [];
  let cArrayVarNames: Set<string> = new Set();
  const sourceMapEntries: SourceMapEntry[] = [];
  const headerMapEntries: SourceMapEntry[] = [];

  function appendSourceLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    sourceLines.push(line);
    if (!entry) {
      return;
    }

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

  function appendHeaderLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    headerLines.push(line);
    if (!entry) {
      return;
    }

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

  function appendRenderedStatement(
    statement: StatementIR,
    indent: string,
    scopeState: EmissionScopeState,
  ): void {
    emitCommentLines(statement.leadingComments, indent, (line) => appendSourceLine(line));

    if (statement.kind === "while") {
      const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
      for (const line of prelude) appendSourceLine(`${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      const nestedScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) appendRenderedStatement(nested, `${indent}  `, nestedScope);
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "if") {
      const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
      for (const line of prelude) appendSourceLine(`${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      const thenScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.thenBranch) appendRenderedStatement(nested, `${indent}  `, thenScope);
      appendSourceLine(`${indent}}`);
      if (statement.elseBranch && statement.elseBranch.length > 0) {
        appendSourceLine(`${indent}else {`);
        const elseScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.elseBranch) appendRenderedStatement(nested, `${indent}  `, elseScope);
        appendSourceLine(`${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for" || statement.kind === "for_of" || statement.kind === "for_in") {
      const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
      for (const line of prelude) appendSourceLine(`${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      const nestedScope = cloneEmissionScopeState(scopeState);
      if (statement.kind === "for_in" && statement.keys && statement.keys.length > 0 && statement.variable.kind === "var_decl") {
        const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
        const idxVar = `_ki_${objName}`;
        const safeName = escapeCppKeyword(statement.variable.name, platformReservedNames);
        appendSourceLine(`${indent}  const char* ${safeName} = ${idxVar}_keys[${idxVar}];`);
      }
      for (const nested of statement.body) appendRenderedStatement(nested, `${indent}  `, nestedScope);
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "do_while") {
      appendSourceLine(`${indent}do`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      const nestedScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) appendRenderedStatement(nested, `${indent}  `, nestedScope);
      const renderedCondition = exprRenderer.render(statement.condition, undefined, scopeState.knownVariableTypes);
      appendSourceLine(`${indent}} while (${renderedCondition});`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "switch") {
      const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(statement, false, fixPointerFieldAccess, scopeState.knownVariableTypes);
      for (const line of prelude) appendSourceLine(`${indent}${line}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}${rendered}`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      for (const caseClause of statement.cases) {
        emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(line));
        if (caseClause.value !== undefined) {
          const renderedValue = exprRenderer.render(caseClause.value, undefined, scopeState.knownVariableTypes);
          appendSourceLine(`${indent}  case ${renderedValue}:`);
        } else {
          appendSourceLine(`${indent}  default:`);
        }
        const nestedScope = cloneEmissionScopeState(scopeState);
        for (const nested of caseClause.body) appendRenderedStatement(nested, `${indent}    `, nestedScope);
        emitCommentLines(caseClause.trailingComments, `${indent}  `, (line) => appendSourceLine(line));
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "block") {
      appendSourceLine(`${indent}{`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      const nestedScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) appendRenderedStatement(nested, `${indent}  `, nestedScope);
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "try") {
      appendSourceLine(`${indent}try`, { tsSpan: statement.sourceSpan, nodeKind: statement.kind });
      appendSourceLine(`${indent}{`);
      const tryScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.tryBlock) appendRenderedStatement(nested, `${indent}  `, tryScope);
      appendSourceLine(`${indent}}`);
      if (statement.catchBlock) {
        appendSourceLine(`${indent}catch (...) {`);
        const catchScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.catchBlock) appendRenderedStatement(nested, `${indent}  `, catchScope);
        appendSourceLine(`${indent}}`);
      }
      if (statement.finallyBlock) {
        appendSourceLine(`${indent}{ // finally`);
        const finallyScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.finallyBlock) appendRenderedStatement(nested, `${indent}  `, finallyScope);
        appendSourceLine(`${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    const { prelude, statement: rendered } = statementRenderer.renderWithPrelude(
      statement,
      false,
      fixPointerFieldAccess,
      scopeState.knownVariableTypes,
    );

    for (const preludeLine of prelude) {
      appendSourceLine(`${indent}${preludeLine}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
    }

    appendSourceLine(`${indent}${rendered}`, {
      tsSpan: statement.sourceSpan,
      nodeKind: statement.kind,
    });
    if (statement.kind === "var_decl") {
      recordVariableType(statement, scopeState);
    }
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
  }

  if (effectiveEmitMode === "split") {
    appendSourceLine(`#include \"${baseName}.h\"`);
  }

  if (effectiveEmitMode === "split" && program.classes.length > 0) {
    for (const classDef of program.classes) {
      appendHeaderLine(`class ${classDef.name};`);
    }
    appendHeaderLine("");
  }

  // Add iostream for generic C++ when console calls are used (use cached analysis)
  if (strategy.needsIostream() && programAnalysis.hasConsoleCalls) {
    includes.push("<iostream>");
  }

  // Use cached analysis results instead of multiple traversals
  const usesVectorTypes = programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral;
  // For Arduino AVR, std::string is not available - skip the include
  if (programAnalysis.usesStdString && strategy.needsStdString()) {
    includes.push("<string>");
  }
  if (strategy.needsStdVector() && programAnalysis.usesVectorTypes) {
    includes.push("<vector>");
  }
  if (strategy.needsStdVector() && programAnalysis.hasArrayInObjectLiteral) {
    includes.push("<vector>");
  }
  if (programAnalysis.usesStdFunction && strategy.needsStdFunction()) {
    includes.push("<functional>");
  }
  if (programAnalysis.hasThrowStatements && strategy.needsStdExcept()) {
    includes.push("<stdexcept>");
  }
  // <type_traits> needed for static_assert on constrained type parameters
  if (program.functions.some(fn => fn.typeParameterConstraints && fn.typeParameterConstraints.size > 0)) {
    includes.push("<type_traits>");
  }
  if (programAnalysis.hasStdMathCalls) {
    includes.push(strategy.mathHeader());
  }
  const needsSnprintf = strategy.useSnprintfForStrings() && (
    program.topLevelStatements.some((statement) => statementNeedsSnprintf(statement, strategy)) ||
    program.functions.some((fn) => fn.statements.some((statement) => statementNeedsSnprintf(statement, strategy))) ||
    program.classes.some((classDef) =>
      (classDef.constructor?.statements.some((statement) => statementNeedsSnprintf(statement, strategy)) ?? false) ||
      classDef.methods.some((method) => method.statements.some((statement) => statementNeedsSnprintf(statement, strategy)))
    )
  );
  if (needsSnprintf) {
    includes.push("<stdio.h>");
    includes.push("<stdlib.h>");
  }
  if (emittedPolyfills) {
    includes.push(...emittedPolyfills.includes.map((include) => normalizeInclude(include)));
  }

  // Auto-include library headers registered by inline evaluators
  if (program.requiredIncludes) {
    includes.push(...program.requiredIncludes);
  }

  for (const include of dedupe(includes)) {
    appendSourceLine(`#include ${include}`);
  }

  appendSourceLine("");

  // Boilerplate rendering is now handled by the strategy or shims

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

  // Emit async state-machine class + instance declarations (one per async function).
  // These must appear after the polyfill runtime (MicrotaskQueue, Promise) and
  // before setup()/loop() so that loop() can call taskVar.run().
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

  if (strategy.needsVectorOverload() && hasConsoleCalls(program, strategy) && usesVectorTypes) {
    appendSourceLine("template <typename T>");
    appendSourceLine("std::ostream& operator<<(std::ostream& os, const std::vector<T>& values)");
    appendSourceLine("{");
    appendSourceLine("  os << \"[\";");
    appendSourceLine("  for (size_t i = 0; i < values.size(); ++i)");
    appendSourceLine("  {");
    appendSourceLine("    if (i > 0)");
    appendSourceLine("    {");
    appendSourceLine("      os << \", \";");
    appendSourceLine("    }");
    appendSourceLine("    os << values[i];");
    appendSourceLine("  }");
    appendSourceLine("  os << \"]\";");
    appendSourceLine("  return os;");
    appendSourceLine("}");
    appendSourceLine("");
  }

  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLine(line);
    }
    appendSourceLine("");
  }


  // Reserved names that conflict with macros/globals predefined by the target framework.
  // Provided by the platform strategy (e.g. Arduino defines HIGH, LOW, A0, etc.).
  const reservedNames = strategy.reservedNames();

  // Build set of compile-time (non-runtime) declared top-level variable names.
  // Used below when emitting struct initializers to zero-initialize forward-referenced
  // or suppressed runtime variables (like pin constants D0, D1, TX2 etc.).
  const compiletimeVarNames = new Set<string>(
    program.topLevelStatements
      .filter((stmt) => stmt.kind === "var_decl" && !statementRequiresRuntime(stmt))
      .map((stmt) => (stmt as { name: string }).name)
  );

  // Separate compile-time declarations from runtime statements
  // Compile-time declarations (literals, simple identifiers, static arrays) can go at global scope
  // Runtime statements (method calls, new expressions, etc.) must go in setup()/main()
  const topLevelDeclarations = program.topLevelStatements.filter(
    (item) => !statementRequiresRuntime(item)
  );
  // Filter out reserved names from the target platform
  const filteredTopLevelDeclarations = reservedNames.size > 0
    ? topLevelDeclarations.filter((item) => {
      if (item.kind === "var_decl") {
        return !reservedNames.has(item.name);
      }
      return true;
    })
    : topLevelDeclarations;
  const topLevelExecutables = program.topLevelStatements.filter(
    (item) => statementRequiresRuntime(item)
  );
  // Also suppress runtime var_decl statements whose names clash with
  // framework predefined symbols (e.g. A0, Serial).
  const filteredTopLevelExecutables_presuppress = reservedNames.size > 0
    ? topLevelExecutables.filter((item) => {
      if (item.kind === "var_decl") {
        return !reservedNames.has(item.name);
      }
      return true;
    })
    : topLevelExecutables;

  const entrypointFunctionName = strategy.entrypointFunctionName();
  const entrypointCallNames = new Set<string>([entrypointFunctionName]);
  for (const fn of program.functions) {
    if (mapFunctionName(fn.originalName, strategy) === entrypointFunctionName) {
      entrypointCallNames.add(fn.originalName);
      entrypointCallNames.add(applySymbolMap(fn.originalName, symbolMap));
    }
  }

  const filteredTopLevelExecutables = filteredTopLevelExecutables_presuppress.filter((statement) => {
    if (statement.kind !== "call") {
      return true;
    }

    const mappedCallee = applySymbolMap(statement.callee, symbolMap);
    // Filter out calls to entrypoint functions (setup/main) and async functions.
    // Async function calls are replaced by cooperative task instances driven in loop().
    if (!entrypointCallNames.has(statement.callee) && !entrypointCallNames.has(mappedCallee)) {
      return !asyncFunctionOriginalNames.has(statement.callee) && !asyncFunctionMappedNames.has(statement.callee);
    }
    return false;
  });

  const emittedTopLevelStatements = isEntryFile
    ? filteredTopLevelDeclarations
    : [
      ...filteredTopLevelDeclarations,
      ...filteredTopLevelExecutables.filter((statement) => statement.kind === "var_decl"),
    ];

  const knownTopLevelObjectTypes = new Map<string, string>();
  const knownTopLevelObjectFields = new Map<string, Map<string, string>>();

  // Collect pointer variable types from all executable statements
  const allExecutableStatements: StatementIR[] = [...filteredTopLevelExecutables];
  for (const fn of mappedFunctions) {
    allExecutableStatements.push(...fn.statements);
  }
  const globalPointerVarTypes = collectPointerVarTypes(allExecutableStatements, classNameMap);

  // ── Promote timing variables to unsigned long ────────────────────────────
  // Variables that receive millis()/micros() return values must be unsigned long
  // to avoid truncation on platforms where int is 16-bit (e.g. AVR ATmega328P).
  {
    const timingVarNames = new Set<string>();

    function exprContainsTimingCall(expr: ExpressionIR): boolean {
      if (!expr || typeof expr !== 'object' || !expr.kind) return false;
      switch (expr.kind) {
        case "method-call":
          return /\bmillis\b/.test(expr.callee) || /\bmicros\b/.test(expr.callee);
        case "raw":
          return /\bmillis\s*\(/.test(expr.value) || /\bmicros\s*\(/.test(expr.value);
        case "identifier":
          return timingVarNames.has(expr.value);
        case "binary":
          return exprContainsTimingCall(expr.left) || exprContainsTimingCall(expr.right);
        case "unary":
          return exprContainsTimingCall(expr.operand);
        case "paren":
          return exprContainsTimingCall(expr.inner);
        case "ternary":
          return exprContainsTimingCall(expr.condition) || exprContainsTimingCall(expr.whenTrue) || exprContainsTimingCall(expr.whenFalse);
        case "property-access":
          return exprContainsTimingCall(expr.object);
        case "element-access":
          return exprContainsTimingCall(expr.object) || exprContainsTimingCall(expr.index);
        default:
          return false;
      }
    }

    function scanForTimingAssignments(stmts: StatementIR[]): void {
      for (const stmt of stmts) {
        if (stmt.kind === "var_decl" && stmt.initializer && exprContainsTimingCall(stmt.initializer)) {
          timingVarNames.add(stmt.name);
        }
        if (stmt.kind === "assign" && exprContainsTimingCall(stmt.value)) {
          timingVarNames.add(stmt.target);
        }
        // Recurse into nested statement blocks
        if ("body" in stmt && Array.isArray(stmt.body)) scanForTimingAssignments(stmt.body);
        if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) scanForTimingAssignments(stmt.thenBranch);
        if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) scanForTimingAssignments(stmt.elseBranch);
        if ("cases" in stmt && Array.isArray(stmt.cases)) {
          for (const c of stmt.cases) scanForTimingAssignments(c.body);
        }
        if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) scanForTimingAssignments(stmt.tryBlock);
        if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) scanForTimingAssignments(stmt.catchBlock);
        if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) scanForTimingAssignments(stmt.finallyBlock);
      }
    }

    // Collect all statements to scan (globals + function bodies)
    const allStatementsForTiming: StatementIR[] = [...emittedTopLevelStatements];
    for (const fn of mappedFunctions) {
      allStatementsForTiming.push(...fn.statements);
    }

    // Multiple passes to handle transitive assignments (e.g., now = millis(); lastTime = now)
    for (let pass = 0; pass < 3; pass++) {
      const prevSize = timingVarNames.size;
      scanForTimingAssignments(allStatementsForTiming);
      if (timingVarNames.size === prevSize) break;
    }

    // Promote matching var_decl cppType to unsigned long
    function promoteVarDecls(stmts: StatementIR[]): void {
      for (const stmt of stmts) {
        if (stmt.kind === "var_decl" && timingVarNames.has(stmt.name)) {
          const t = stmt.cppType;
          if (t === "auto" || t === "int" || t === "long" || t === "unsigned int" || t === "short" || t === "unsigned short") {
            (stmt as any).cppType = "unsigned long";
          }
        }
        if ("body" in stmt && Array.isArray(stmt.body)) promoteVarDecls(stmt.body);
        if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) promoteVarDecls(stmt.thenBranch);
        if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) promoteVarDecls(stmt.elseBranch);
        if ("cases" in stmt && Array.isArray(stmt.cases)) {
          for (const c of stmt.cases) promoteVarDecls(c.body);
        }
        if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) promoteVarDecls(stmt.tryBlock);
        if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) promoteVarDecls(stmt.catchBlock);
        if ("finallyBlock" in stmt && Array.isArray(stmt.finallyBlock)) promoteVarDecls(stmt.finallyBlock);
      }
    }

    promoteVarDecls(allStatementsForTiming);
  }


  // Collect callback functions from call arguments (e.g., attachInterrupt handlers)
  const callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[] = [];
  let callbackCounter = 0;

  function collectCallbacks(statements: StatementIR[]): void {
    for (const stmt of statements) {
      if (stmt.kind === "call") {
        for (const arg of stmt.args) {
          collectCallbackFromExpression(arg);
        }
      }
      // Scan var_decl initializers for callbacks in method-call expressions
      if (stmt.kind === "var_decl" && stmt.initializer) {
        collectCallbackFromExpression(stmt.initializer);
      }
      // Recurse into nested statements
      if ("body" in stmt && Array.isArray(stmt.body)) {
        collectCallbacks(stmt.body);
      }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
        collectCallbacks(stmt.thenBranch);
      }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
        collectCallbacks(stmt.elseBranch);
      }
      if ("cases" in stmt && Array.isArray(stmt.cases)) {
        for (const c of stmt.cases) {
          collectCallbacks(c.body);
        }
      }
      if ("value" in stmt && stmt.value) {
        collectCallbackFromExpression(stmt.value);
      }
    }
  }

  function collectCallbackFromExpression(expr: ExpressionIR): void {
    // Handle top-level callback (e.g., in call statement args directly)
    if (expr.kind === "callback") {
      const callbackName = `${isrPrefix}_isr_${callbackCounter++}`;
      callbackFunctions.push({
        name: callbackName,
        params: expr.params,
        statements: expr.statements,
        debounceMs: expr.debounceMs,
      });
      (expr as any).kind = "identifier";
      (expr as any).value = callbackName;
      return;
    }
    if (expr.kind === "method-call") {
      for (const arg of expr.args) {
        if (arg.kind === "callback") {
          const callbackName = `${isrPrefix}_isr_${callbackCounter++}`;
          callbackFunctions.push({
            name: callbackName,
            params: arg.params,
            statements: arg.statements,
            debounceMs: arg.debounceMs,
          });
          (arg as any).kind = "identifier";
          (arg as any).value = callbackName;
        } else {
          collectCallbackFromExpression(arg);
        }
      }
    }
    // Recurse into other expression kinds that may contain nested method-calls
    if (expr.kind === "raw") return;
    if ("args" in expr && Array.isArray(expr.args)) {
      for (const arg of expr.args) { collectCallbackFromExpression(arg); }
    }
    if ("initializer" in expr && expr.initializer) { collectCallbackFromExpression(expr.initializer as ExpressionIR); }
    if ("value" in expr && expr.value && typeof expr.value === "object") { collectCallbackFromExpression(expr.value); }
    if ("left" in expr) { collectCallbackFromExpression(expr.left); }
    if ("right" in expr) { collectCallbackFromExpression(expr.right); }
    if ("condition" in expr && typeof expr.condition === "object") { collectCallbackFromExpression(expr.condition); }
    if ("whenTrue" in expr) { collectCallbackFromExpression(expr.whenTrue); }
    if ("whenFalse" in expr) { collectCallbackFromExpression(expr.whenFalse); }
    if ("inner" in expr) { collectCallbackFromExpression(expr.inner); }
    if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { collectCallbackFromExpression(expr.object); }
    if ("elements" in expr && Array.isArray(expr.elements)) {
      for (const e of expr.elements) { collectCallbackFromExpression(e); }
    }
  }

  collectCallbacks(filteredTopLevelExecutables);
  for (const fn of mappedFunctions) {
    collectCallbacks(fn.statements);
  }

  // Also scan class method statements for callbacks
  for (const cls of program.classes) {
    if (cls.constructor) {
      collectCallbacks(cls.constructor.statements);
    }
    for (const method of cls.methods) {
      collectCallbacks(method.statements);
    }
    for (const getter of cls.getters) {
      collectCallbacks(getter.statements);
    }
    for (const setter of cls.setters) {
      collectCallbacks(setter.statements);
    }
  }

  // Process registered callbacks from HAL resolver (callback() directive)
  for (const rc of registeredCallbacks) {
    const callbackName = `${isrPrefix}_isr_${callbackCounter++}`;
    callbackFunctions.push({
      name: callbackName,
      params: rc.callbackIR.params,
      statements: rc.callbackIR.statements,
      debounceMs: rc.callbackIR.debounceMs,
    });
    replacePlaceholderInAllStatements(filteredTopLevelExecutables, rc.placeholderName, callbackName);
    for (const fn of mappedFunctions) {
      replacePlaceholderInAllStatements(fn.statements, rc.placeholderName, callbackName);
    }
  }

  // Promote runtime var_decls that are referenced in ISR callbacks to file scope.
  // ISRs are emitted as file-scope free functions, so they can't access setup()-local variables.
  // We emit a forward declaration at file scope and convert the var_decl to an assignment in setup().

  function replacePlaceholderInStmt(stmt: any, placeholder: string, replacement: string): void {
    if (stmt.kind === "call" && stmt.callee === "__EMIT__" && stmt.args) {
      for (const arg of stmt.args) {
        if (arg.kind === "string" && typeof arg.value === "string" && arg.value.includes(placeholder)) {
          arg.value = arg.value.replace(placeholder, replacement);
        }
      }
    }
    // Handle hal-op statements with raw code containing callback placeholders
    if (stmt.kind === "hal-op" && stmt.operation && stmt.operation.operation === "raw" && typeof stmt.operation.code === "string") {
      stmt.operation.code = stmt.operation.code.replace(placeholder, replacement);
    }
    for (const key of ["body", "thenBranch", "elseBranch"]) {
      if (Array.isArray(stmt[key])) {
        for (const s of stmt[key]) replacePlaceholderInStmt(s, placeholder, replacement);
      }
    }
    if (stmt.cases && Array.isArray(stmt.cases)) {
      for (const c of stmt.cases) {
        if (c.body) for (const s of c.body) replacePlaceholderInStmt(s, placeholder, replacement);
      }
    }
    if (stmt.statements && Array.isArray(stmt.statements)) {
      for (const s of stmt.statements) replacePlaceholderInStmt(s, placeholder, replacement);
    }
  }

  function replacePlaceholderInAllStatements(statements: StatementIR[], placeholder: string, replacement: string): void {
    for (const stmt of statements) {
      replacePlaceholderInStmt(stmt, placeholder, replacement);
    }
  }

  function collectIdentifierNames(statements: StatementIR[]): Set<string> {
    const names = new Set<string>();
    function scanStmt(stmt: StatementIR) {
      if (stmt.kind === "var_decl") { names.add(stmt.name); }
      if ("target" in stmt && typeof stmt.target === "string") {
        // extract identifiers from target like "this->field"
      }
      if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) scanStmt(s); }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) scanStmt(s); }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) scanStmt(s); }
      if ("cases" in stmt && Array.isArray(stmt.cases)) { for (const c of stmt.cases) for (const s of c.body) scanStmt(s); }
      if ("value" in stmt && stmt.value && typeof stmt.value === "object") { scanExpr(stmt.value); }
      if ("callee" in stmt && typeof stmt.callee === "string") {
        // extract identifiers from callee like "btn->check"
        const parts = stmt.callee.split(/[\.\-\>]/);
        for (const p of parts) { if (/^[a-zA-Z_]\w*$/.test(p)) names.add(p); }
      }
      if ("args" in stmt && Array.isArray(stmt.args)) { for (const a of stmt.args) scanExpr(a); }
    }
    function scanExpr(expr: ExpressionIR) {
      if (expr.kind === "identifier") { names.add(expr.value); }
      if ("left" in expr) { scanExpr(expr.left); }
      if ("right" in expr) { scanExpr(expr.right); }
      if ("value" in expr && expr.value && typeof expr.value === "object") { scanExpr(expr.value); }
      if ("elements" in expr && Array.isArray(expr.elements)) { for (const e of expr.elements) scanExpr(e); }
      if ("args" in expr && Array.isArray(expr.args)) { for (const a of expr.args) scanExpr(a); }
      if ("initializer" in expr && expr.initializer) { scanExpr(expr.initializer as ExpressionIR); }
      if ("condition" in expr && typeof expr.condition === "object") { scanExpr(expr.condition); }
      if ("whenTrue" in expr) { scanExpr(expr.whenTrue); }
      if ("whenFalse" in expr) { scanExpr(expr.whenFalse); }
      if ("inner" in expr) { scanExpr(expr.inner); }
      if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { scanExpr(expr.object); }
    }
    for (const stmt of statements) { scanStmt(stmt); }
    return names;
  }

  const promotedVarDecls = new Map<string, { cppType: string; index: number }>();
  if (callbackFunctions.length > 0 && filteredTopLevelExecutables.length > 0) {
    // Collect all identifiers referenced inside ISR callback bodies
    const isrIdentifiers = new Set<string>();
    for (const cb of callbackFunctions) {
      for (const id of collectIdentifierNames(cb.statements)) {
        isrIdentifiers.add(id);
      }
    }
    // Find runtime var_decls that are referenced in ISR callbacks
    for (let i = 0; i < filteredTopLevelExecutables.length; i++) {
      const stmt = filteredTopLevelExecutables[i];
      if (stmt.kind === "var_decl" && isrIdentifiers.has(stmt.name)) {
        const varType = normalizeCppTypeForTarget(stmt.cppType, strategy);
        promotedVarDecls.set(stmt.name, { cppType: varType, index: i });
        // Convert var_decl to assignment statement (remove type declaration)
        (filteredTopLevelExecutables[i] as any) = {
          kind: "assign",
          sourceSpan: stmt.sourceSpan,
          leadingComments: stmt.leadingComments,
          trailingComments: stmt.trailingComments,
          target: stmt.name,
          operator: "=",
          value: stmt.initializer,
        };
      }
    }
  }

  // Collect struct field types that are pointers - needed for correct -> access
  const pointerStructFields = new Set<string>();
  for (const stmt of allExecutableStatements) {
    if (stmt.kind === "var_decl" && stmt.initializer?.kind === "object") {
      const structName = stmt.name;
      for (const field of stmt.initializer.fields) {
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes, knownFunctionReturnTypes, undefined, undefined, largeEnumNames, structName, field.name, strategy.defaultNumericType(), (o, n) => strategy.resolvePinType?.(o, n));
        if (fieldType.endsWith("*")) {
          pointerStructFields.add(`${structName}.${field.name}`);
        }
      }
    }
  }

  /**
   * Transform method calls on pointer variables and pointer struct fields from '.' to '->'
   * e.g., "sensor.readTemperature()" -> "sensor->readTemperature()" when sensor is a pointer
   * e.g., "Board.A0.read()" -> "Board.A0->read()" when A0 is a pointer field
   */
  function fixPointerFieldAccess(callee: string): string {
    // First, handle top-level pointer variables (e.g., sensor.method() -> sensor->method())
    for (const [varName, varType] of globalPointerVarTypes) {
      if (varType.endsWith("*")) {
        // Match patterns like "varName.method" and transform to "varName->method"
        const pattern = new RegExp(`\\b${varName}\\.`, "g");
        callee = callee.replace(pattern, `${varName}->`);
      }
    }

    // Then, handle pointer struct fields (e.g., Board.A0.method() -> Board.A0->method())
    for (const pointerField of pointerStructFields) {
      // Match patterns like "Board.A0.method" and transform to "Board.A0->method"
      const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
      callee = callee.replace(pattern, `$1${pointerField}->`);
    }
    return callee;
  }

  // Merge top-level executables into the entrypoint function
  if (isEntryFile && filteredTopLevelExecutables.length > 0) {
    const epName = entrypointFunctionName;  // "setup" or "main"
    const existingEp = mappedFunctions.find(fn => fn.name === epName);

    // Get platform-specific setup init code (e.g., UART initialization)
    // These are complete C++ statements, so we use a special marker to emit them as-is
    const setupInitLines = strategy.setupInitCode?.(program, options.platformContext) ?? [];
    const setupInitStmts: StatementIR[] = setupInitLines.map(line => ({
      kind: "call" as const,
      callee: `__RAW_STMT__${line}`,
      args: [],
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    }));

    // Combine platform setup init code
    const allSetupInitStmts = [...setupInitStmts];

    if (existingEp) {
      existingEp.statements = [...allSetupInitStmts, ...filteredTopLevelExecutables, ...existingEp.statements];
    } else {
      // Arduino-style: void setup(); Generic: int main() with return 0
      const isMain = epName === "main";
      const returnType = isMain ? "int" : "void";
      const stmts: StatementIR[] = isMain
        ? [...allSetupInitStmts, ...filteredTopLevelExecutables, { kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
        : [...allSetupInitStmts, ...filteredTopLevelExecutables];
      const insertFn = {
        name: epName,
        originalName: epName,
        returnType,
        sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        leadingComments: [`// Auto-generated ${epName}() for top-level statements`],
        trailingComments: undefined,
        parameters: [],
        isAsync: false,
        typeParameters: undefined,
        typeParameterConstraints: undefined,
        isReadonlyReturnType: false,
        statements: stmts,
      };
      if (isMain) {
        mappedFunctions.push(insertFn);
      } else {
        mappedFunctions.unshift(insertFn);
      }
    }
  }

  // Ensure the entrypoint function (setup/main) exists even when all top-level
  // executables were filtered out (e.g., only async function calls remain which
  // are replaced by cooperative task instances driven in loop()).
  if (isEntryFile && !mappedFunctions.some((fn) => fn.name === entrypointFunctionName)) {
    const isMain = entrypointFunctionName === "main";
    const returnType = mapReturnType(entrypointFunctionName, isMain ? "int" : "void", strategy);
    const stmts: StatementIR[] = isMain
      ? [{ kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
      : [];
    const insertFn = {
      name: entrypointFunctionName,
      returnType,
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: stmts,
    };
    if (isMain) {
      mappedFunctions.push(insertFn);
    } else {
      mappedFunctions.unshift(insertFn);
    }
  }

  // Some platforms require a loop/main-loop function even if empty
  if (isEntryFile && strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "loop")) {
    mappedFunctions.push({
      name: "loop",
      returnType: "void",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: hasAsyncRuntime ? ["// Auto-generated loop() for async microtask pumping"] : undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: [],
    });
  }

  // Only generate main() for entry files when there's no loop-based strategy
  if (isEntryFile && hasAsyncRuntime && !strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "main")) {
    mappedFunctions.push({
      name: "main",
      returnType: mapReturnType("main", "int", strategy),
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: [{ kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
    });
  }

  // Enum class names that are already declared as C typedefs in the target API.
  // Guard them with a preprocessor conditional so they are only emitted when needed.
  const apiReservedEnums = strategy.apiReservedEnumNames();

  // Emit register-mapped structs (volatile pointers to MMIO addresses)
  for (const reg of program.registerClasses ?? []) {
    const addrHex = '0x' + reg.address.toString(16).toUpperCase().replace(/^0X/, '');
    emitCommentLines(reg.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`volatile uint32_t* const ${reg.name} = reinterpret_cast<volatile uint32_t*>(${addrHex});`);
    emitCommentLines(reg.trailingComments, "", (line) => appendSourceLine(line));
  }
  if ((program.registerClasses?.length ?? 0) > 0) {
    appendSourceLine("");
  }

  // Emit enums
  for (const enumDef of program.enums) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(enumDef.leadingComments, "", (line) => appendLine(line));
    const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
    // Add an explicit underlying type for enums that contain values outside the
    // platform's default int range (e.g. AVR int is 16-bit).
    const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
      enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
    const underlyingType = needsLongUnderlying ? " : long" : "";
    // Guard enum classes that conflict with target API typedef declarations.
    const guard = apiReservedEnums.has(enumDef.name) ? strategy.enumApiGuard(enumDef.name) : undefined;
    if (guard) {
      appendLine(guard.open);
    }
    appendLine(`${enumKeyword} ${enumDef.name}${underlyingType} {`);
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      // Prefix reserved names for platform compatibility
      const memberName = reservedNames.has(member.name)
        ? `_${member.name}`
        : member.name;
      appendLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendLine("};");
    if (guard) {
      appendLine(guard.close);
    }
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(line));

    // Object literal type aliases become struct definitions
    if (typeAlias.structFields && typeAlias.structFields.length > 0) {
      appendLine(`struct ${typeAlias.name} {`);
      for (const field of typeAlias.structFields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType, strategy);
        appendLine(`  ${fieldType} ${field.name};`);
      }
      appendLine("};");
      emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
      appendLine("");
      continue;
    }

    // Skip type aliases with 'auto' as it's not valid in C++ type aliases
    // Also skip for Arduino if the type uses std::string (not available on AVR)
    const cppType = normalizeCppTypeForTarget(typeAlias.cppType, strategy);
    if (cppType === "auto") {
      continue; // Skip invalid 'auto' type aliases
    }
    if (strategy.shouldSkipTypeAlias(cppType)) {
      continue; // Strategy decided to skip this type alias
    }
    appendLine(`using ${typeAlias.name} = ${cppType};`);
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit interfaces as C++ structs
  for (const iface of program.interfaces) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(iface.leadingComments, "", (line) => appendLine(line));
    if (iface.fields.length > 0) {
      if (iface.parentScope) {
        appendLine(`namespace ${iface.parentScope} {`);
        interfaceNamespaceMap.set(iface.name, iface.parentScope);
      }
      // Detect type parameter names (single uppercase letters used as field types)
      const typeParams = new Set<string>();
      for (const field of iface.fields) {
        const rawType = field.cppType;
        if (/^[A-Z]$/.test(rawType)) {
          typeParams.add(rawType);
        }
      }
      if (typeParams.size > 0) {
        appendLine(`template<typename ${Array.from(typeParams).join(", typename ")}>`);
      }
      appendLine(`struct ${iface.name} {`);
      for (const field of iface.fields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType, strategy);
        appendLine(`  ${fieldType} ${field.name};`);
      }
      appendLine("};");
      if (iface.parentScope) {
        appendLine("}");
      }
    }
    emitCommentLines(iface.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit top-level constant declarations BEFORE classes so that constants
  // used in class constructor default parameters are defined first.
  // ONLY emit compile-time declarations here (literals, simple identifiers).
  // Runtime declarations (new expressions, function calls) must go AFTER classes.
  for (const statement of emittedTopLevelStatements) {
    if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
      continue;
    }
    appendRenderedStatement(statement, "", topLevelScope);
  }
  if (emittedTopLevelStatements.some(s =>
    s.kind === "var_decl" &&
    !(s.initializer && isRuntimeExpression(s.initializer))
  )) {
    appendSourceLine("");
  }

  // Emit namespaces
  for (const ns of program.namespaces) {
    emitCommentLines(ns.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`namespace ${ns.name} {`);
    appendSourceLine("");

    // Emit namespace enums
    for (const enumDef of ns.enums) {
      emitCommentLines(enumDef.leadingComments, "  ", (line) => appendSourceLine(line));
      const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
      const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
        enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
      const underlyingType = needsLongUnderlying ? " : long" : "";
      appendSourceLine(`  ${enumKeyword} ${enumDef.name}${underlyingType} {`);
      for (let i = 0; i < enumDef.members.length; i++) {
        const member = enumDef.members[i];
        const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
        const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
        appendSourceLine(`    ${member.name}${valueSuffix}${commaSuffix}`);
      }
      appendSourceLine("  };");
      emitCommentLines(enumDef.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }

    // Emit namespace type aliases
    for (const typeAlias of ns.typeAliases) {
      emitCommentLines(typeAlias.leadingComments, "  ", (line) => appendSourceLine(line));
      const cppType = normalizeCppTypeForTarget(typeAlias.cppType, strategy);
      if (cppType !== "auto" && !strategy.shouldSkipTypeAlias(cppType)) {
        appendSourceLine(`  using ${typeAlias.name} = ${cppType};`);
        emitCommentLines(typeAlias.trailingComments, "  ", (line) => appendSourceLine(line));
        appendSourceLine("");
      }
    }

    // Emit namespace constants
    for (const constant of ns.constants) {
      const constType = normalizeCppTypeForTarget(constant.cppType, strategy);
      if (constType !== "auto") {
        appendSourceLine(`  const ${constType} ${constant.name} = ${renderExpression(constant.value, undefined)};`);
      } else {
        appendSourceLine(`  const auto ${constant.name} = ${renderExpression(constant.value, undefined)};`);
      }
    }
    if (ns.constants.length > 0) {
      appendSourceLine("");
    }

    // Emit namespace classes
    for (const classDef of ns.classes) {
      emitCommentLines(classDef.leadingComments, "  ", (line) => appendSourceLine(line));

      if (classDef.isAbstract) {
        appendSourceLine(`  // Abstract class - contains pure virtual methods`);
      }

      appendSourceLine(`  class ${classDef.name} {`);

      // Group fields and methods by visibility
      const publicFields = classDef.fields.filter(f => f.visibility === "public");
      const privateFields = classDef.fields.filter(f => f.visibility === "private");
      const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
      const publicMethods = classDef.methods.filter(m => m.visibility === "public");
      const privateMethods = classDef.methods.filter(m => m.visibility === "private");
      const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");

      // Public section
      const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor || callbackFunctions.length > 0;
      if (needsPublicSection) {
        appendSourceLine("  public:");
        if (callbackFunctions.length > 0) {
          for (const callback of callbackFunctions) {
            appendSourceLine(`    friend void ${callback.name}();`);
          }
          appendSourceLine("");
        }

        if (classDef.constructor) {
          const ctorParams = renderParameters(classDef.constructor.parameters);
          appendSourceLine(`    ${classDef.name}(${ctorParams}) {`);
          const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
          for (const stmt of classDef.constructor.statements) {
            appendRenderedStatement(stmt, "      ", ctorScope);
          }
          appendSourceLine("    }");
          appendSourceLine("");
        }

        for (const field of publicFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        if (publicFields.length > 0) {
          appendSourceLine("");
        }

        for (const method of publicMethods) {
          const methodParams = renderParameters(method.parameters);
          const staticPrefix = method.isStatic ? "static " : "";
          const returnType = normalizeCppTypeForTarget(method.returnType, strategy);

          if (method.isAbstract) {
            appendSourceLine(`    virtual ${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) = 0;`);
            appendSourceLine("");
            continue;
          }

          appendSourceLine(`    ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", methodScope);
          }
          appendSourceLine("    }");
          appendSourceLine("");
        }
      }

      // Private section
      if (privateFields.length > 0 || privateMethods.length > 0) {
        appendSourceLine("  private:");
        for (const field of privateFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        for (const method of privateMethods) {
          const methodParams = renderParameters(method.parameters);
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", methodScope);
          }
          appendSourceLine("    }");
        }
      }

      // Protected section
      if (protectedFields.length > 0 || protectedMethods.length > 0) {
        appendSourceLine("  protected:");
        for (const field of protectedFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        for (const method of protectedMethods) {
          const methodParams = renderParameters(method.parameters);
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", methodScope);
          }
          appendSourceLine("    }");
        }
      }

      appendSourceLine("  };");
      emitCommentLines(classDef.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }

    // Emit namespace functions
    for (const fn of ns.functions) {
      const parameterList = renderParameters(fn.parameters);
      emitCommentLines(fn.leadingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine(`  ${normalizeCppTypeForTarget(fn.returnType, strategy)} ${fn.originalName}(${parameterList}) {`);
      const namespaceFunctionScope = createChildEmissionScope(topLevelScope, fn.parameters);
      for (const statement of fn.statements) {
        appendRenderedStatement(statement, "    ", namespaceFunctionScope);
      }
      appendSourceLine("  }");
      emitCommentLines(fn.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }

    appendSourceLine(`} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }


  // Emit classes
  // Forward-declare classes that are used as base classes so the compiler
  // knows they exist before the derived class definition.
  const localClassNames = new Set(program.classes.map(c => c.name));
  const baseClassesNeeded = new Set<string>();
  for (const classDef of program.classes) {
    if (classDef.extendsClass && !localClassNames.has(classDef.extendsClass)) {
      // Base class is NOT defined in this file — it's either from an import
      // or another module. No forward-declaration needed (the header handles it).
    } else if (classDef.extendsClass && localClassNames.has(classDef.extendsClass)) {
      baseClassesNeeded.add(classDef.extendsClass);
    }
  }
  // Emit forward declarations for locally-defined base classes that appear
  // AFTER their derived class in the program.classes array (ordering issue).
  for (const classDef of program.classes) {
    if (classDef.extendsClass && baseClassesNeeded.has(classDef.extendsClass)) {
      // Find the index of the base class and derived class
      const baseIdx = program.classes.findIndex(c => c.name === classDef.extendsClass);
      const derivedIdx = program.classes.findIndex(c => c.name === classDef.name);
      if (derivedIdx < baseIdx) {
        // Derived class comes before base — need forward declaration
        appendSourceLine(`class ${classDef.extendsClass};`);
      }
    }
  }

  // Track static member names per class for :: access rendering
  const classStaticMembers = new Map<string, Set<string>>();
  for (const classDef of program.classes) {
    const statics = new Set<string>();
    for (const method of classDef.methods) {
      if (method.isStatic) statics.add(method.name);
    }
    for (const field of classDef.fields) {
      // Check if field has isStatic (future-proofing)
      if ((field as any).isStatic) statics.add(field.name);
    }
    for (const getter of classDef.getters) {
      if (getter.isStatic) statics.add(getter.name);
    }
    for (const setter of classDef.setters) {
      if (setter.isStatic) statics.add(setter.name);
    }
    if (statics.size > 0) {
      classStaticMembers.set(classDef.name, statics);
    }
  }

  // Track string-typed variables for snprintf %s detection
  const stringVarTypes = new Set<string>();
  cArrayVarNames = new Set<string>();
  // Build per-function C-array variable tracking to avoid name collisions
  // across functions (e.g., `arr` can be a C array in one function and a
  // StaticArray in another).
  const fnCArrayVarNames = new Map<string, Set<string>>();
  const addCArrayIfNotMutable = (name: string, normalizedType: string, target: Set<string>) => {
    if (!normalizedType.startsWith("StaticArray<")) {
      target.add(name);
    }
  };
  const isStringLikeType = (t: string) => t === "const char*" || t === "char*" || t === "String";
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      const normalizedType = normalizeCppTypeForTarget(stmt.cppType, strategy);
      if (isStringLikeType(normalizedType)) {
        stringVarTypes.add(stmt.name);
      }
      if (stmt.initializer?.kind === "array") {
        if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
          addCArrayIfNotMutable(stmt.name, normalizedType, cArrayVarNames);
        }
      }
      if (stmt.initializer?.kind === "spread_array") {
        addCArrayIfNotMutable(stmt.name, normalizedType, cArrayVarNames);
      }
    }
  }
  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const fnSet = new Set<string>();
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") {
        const normalizedType = normalizeCppTypeForTarget(stmt.cppType, strategy);
        if (isStringLikeType(normalizedType)) {
          stringVarTypes.add(stmt.name);
        }
        if (stmt.initializer?.kind === "array") {
          if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
            addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
          }
        }
        if (stmt.initializer?.kind === "spread_array") {
          addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
        }
      }
    }
    fnCArrayVarNames.set(String(fi), fnSet);
  }

  // Build class name mapping for getter/setter renaming
  const classAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();
  for (const classDef of program.classes) {
    const accessors = new Map<string, "getter" | "setter" | "both">();
    for (const g of classDef.getters) {
      accessors.set(g.name, accessors.has(g.name) ? "both" : "getter");
    }
    for (const s of classDef.setters) {
      accessors.set(s.name, accessors.has(s.name) ? "both" : "setter");
    }
    if (accessors.size > 0) {
      classAccessorNames.set(classDef.name, accessors);
    }
  }

  // Build variable → accessor map by scanning var_decls for class-typed variables.
  const allVarDecls: { name: string; cppType: string }[] = [];
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") allVarDecls.push(stmt);
  }
  for (const fn of mappedFunctions) {
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") allVarDecls.push(stmt);
    }
  }
  for (const v of allVarDecls) {
    const bareType = v.cppType.replace(/\*$/, "").replace(/^const\s+/, "");
    const accessors = classAccessorNames.get(bareType);
    if (accessors) {
      varAccessorNames.set(v.name, accessors);
    }
  }

  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(line));

    // Build inheritance clause: extends only (implements omitted — C++ has no
    // interface concept; structural compatibility is validated at the TS level)
    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    // Note: TypeScript `implements` is omitted — C++ has no interface concept
    // and the interface type may not exist as a C++ class. The transpiler
    // validates structural compatibility at the TypeScript level already.
    const inheritanceClause = inheritanceParts.length > 0 ? ` : ${inheritanceParts.join(", ")}` : "";

    // Abstract classes get a comment (C++ doesn't have abstract keyword, uses pure virtual methods)
    if (classDef.isAbstract) {
      appendSourceLine(`// Abstract class - contains pure virtual methods`);
    }

    appendSourceLine(`class ${classDef.name}${inheritanceClause} {`);

    // Group fields by visibility
    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const privateFields = classDef.fields.filter(f => f.visibility === "private");
    const protectedFields = classDef.fields.filter(f => f.visibility === "protected");

    const publicMethods = classDef.methods.filter(m => m.visibility === "public");
    const privateMethods = classDef.methods.filter(m => m.visibility === "private");
    const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");
    const publicGetters = classDef.getters.filter(g => g.visibility === "public");
    const publicSetters = classDef.setters.filter(s => s.visibility === "public");
    const privateGetters = classDef.getters.filter(g => g.visibility === "private");
    const privateSetters = classDef.setters.filter(s => s.visibility === "private");
    const protectedGetters = classDef.getters.filter(g => g.visibility === "protected");
    const protectedSetters = classDef.setters.filter(s => s.visibility === "protected");

    const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || publicGetters.length > 0 || publicSetters.length > 0 || classDef.constructor || callbackFunctions.length > 0;
    // Emit public section
    if (needsPublicSection) {
      appendSourceLine("public:");
      if (callbackFunctions.length > 0) {
        for (const callback of callbackFunctions) {
          appendSourceLine(`  friend void ${callback.name}();`);
        }
        appendSourceLine("");
      }

      // Constructor
      if (classDef.constructor) {
        // Normalize constructor parameter types via strategy
        const ctorParamsMapped = classDef.constructor.parameters.map(p => ({
          ...p,
          cppType: normalizeCppTypeForTarget(p.cppType, strategy)
        }));
        const ctorParams = renderParameters(ctorParamsMapped);
        let ctorInitializer = "";
        let ctorStatements = classDef.constructor.statements;
        const firstCtorStatement = ctorStatements[0];
        if (classDef.extendsClass && firstCtorStatement && firstCtorStatement.kind === "call" && firstCtorStatement.callee === "super") {
          const baseArgs = firstCtorStatement.args.map((arg) => renderExpression(arg, fixPointerFieldAccess)).join(", ");
          ctorInitializer = ` : ${classDef.extendsClass}(${baseArgs})`;
          ctorStatements = ctorStatements.slice(1);
        }

        appendSourceLine(`  ${classDef.name}(${ctorParams})${ctorInitializer} {`);
        const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
        for (const stmt of ctorStatements) {
          appendRenderedStatement(stmt, "    ", ctorScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }

      // Public fields
      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (publicFields.length > 0) {
        appendSourceLine("");
      }

      // Public methods
      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(method.returnType, strategy);

        // Handle abstract methods (pure virtual in C++)
        if (method.isAbstract) {
          appendSourceLine(`  virtual ${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) = 0;`);
          appendSourceLine("");
          continue;
        }

        appendSourceLine(`  ${staticPrefix}${returnType} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }

      // Public getters
      for (const getter of publicGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }

      // Public setters
      for (const setter of publicSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", setterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }

    // Emit private section
    if (privateFields.length > 0 || privateMethods.length > 0 || privateGetters.length > 0 || privateSetters.length > 0) {
      appendSourceLine("private:");
      for (const field of privateFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (privateFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const getter of privateGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const setter of privateSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", setterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }

    // Emit protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0 || protectedGetters.length > 0 || protectedSetters.length > 0) {
      appendSourceLine("protected:");
      for (const field of protectedFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (protectedFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name, platformReservedNames)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const getter of protectedGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const setter of protectedSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", setterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }

    appendSourceLine("};");
    emitCommentLines(classDef.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }


  // Emit runtime variable declarations AFTER classes (for non-entry files)
  // These are variables that use 'new' or function calls and need the class defined first
  // For entry files, these go into setup() instead
  if (!isEntryFile) {
    for (const statement of emittedTopLevelStatements) {
      if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
        appendRenderedStatement(statement, "", topLevelScope);
      }
    }
  }

  // Emit forward declarations for promoted runtime var_decls (referenced in ISR callbacks).
  // These need file-scope visibility so ISR free functions can access them.
  // Must come AFTER class definitions so the type is known.
  if (promotedVarDecls.size > 0) {
    for (const [varName, info] of promotedVarDecls) {
      const defaultInit = info.cppType.includes('*') ? 'nullptr' : '0';
      appendSourceLine(`${info.cppType} ${escapeCppKeyword(varName, platformReservedNames)} = ${defaultInit};`);
    }
    appendSourceLine("");
  }

  // Emit object literal struct definitions (after classes so they can reference class types)
  // These were skipped in the earlier pass, so emit only object literals here
  for (const statement of emittedTopLevelStatements) {
    if (
      effectiveEmitMode === "split" &&
      statement.kind === "var_decl" &&
      statement.initializer?.kind === "object"
    ) {
      const structName = `_${statement.name}_t`;

      // Collect and emit nested struct definitions (deepest first)
      const nestedStructs = collectNestedStructDefs(
        statement.initializer, statement.name,
        globalPointerVarTypes, knownFunctionReturnTypes,
        knownTopLevelObjectTypes, knownTopLevelObjectFields, largeEnumNames,
      );
      for (const ns of nestedStructs) {
        const nestedFieldDefs = ns.fields
          .map((f) => `${f.type} ${strategy.renameStructField(f.name)};`)
          .join(" ");
        appendHeaderLine(`struct ${ns.structName} { ${nestedFieldDefs} };`);
      }

      const fieldTypeEntries = statement.initializer.fields.map((field) => {
        const inferred = inferObjectFieldType(
          field.value,
          globalPointerVarTypes,
          knownFunctionReturnTypes,
          knownTopLevelObjectTypes,
          knownTopLevelObjectFields,
          largeEnumNames,
          statement.name,
          field.name,
          strategy.defaultNumericType(),
          (o, n) => strategy.resolvePinType?.(o, n),
        );
        return [field.name, inferred] as const;
      });
      const fieldDefs = fieldTypeEntries
        .map(([fieldName, inferredType]) => {
          // Rename struct fields that match Arduino reserved macro/global names to avoid
          // preprocessor expansion inside struct definitions (e.g. TX2 → (gpio_num_t)25).
          const safeFieldName = strategy.renameStructField(fieldName);
          return `${inferredType} ${safeFieldName};`;
        })
        .join(" ");
      const initValues = statement.initializer.fields
        .map((field) => {
          const renderExpr = (e: ExpressionIR) => renderExpression(e, fixPointerFieldAccess);
          const overridden = strategy.objectFieldInitializer(field.value, renderExpr);
          if (overridden !== undefined) return overridden;
          // Zero-initialize identifier references to non-compile-time variables
          // when they may be forward-referenced or suppressed by the platform.
          const structInit = strategy.structFieldInitializer(field.value, compiletimeVarNames, renderExpr);
          if (structInit !== undefined) return structInit;
          return renderExpression(field.value, fixPointerFieldAccess);
        })
        .join(", ");

      knownTopLevelObjectTypes.set(statement.name, structName);
      knownTopLevelObjectFields.set(statement.name, new Map(fieldTypeEntries));

      emitCommentLines(statement.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`struct ${structName} { ${fieldDefs} };`);
      appendHeaderLine(`extern ${structName} ${statement.name};`);
      emitCommentLines(statement.trailingComments, "", (line) => appendHeaderLine(line));

      emitCommentLines(statement.leadingComments, "", (line) => appendSourceLine(line));
      appendSourceLine(`${structName} ${statement.name} = { ${initValues} };`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, "", (line) => appendSourceLine(line));
    }
  }
  if (emittedTopLevelStatements.some(s => s.kind === "var_decl" && (s as any).initializer?.kind === "object")) {
    appendSourceLine("");
  }

  if (effectiveEmitMode !== "split") {
    const excludedNames = new Set(strategy.forwardDeclarationExclusions?.() ?? []);
    for (const callback of callbackFunctions) {
      appendSourceLine(`${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}();`);
    }
    for (const fn of mappedFunctions) {
      if (excludedNames.has(fn.name)) {
        continue;
      }
      const declarationParameterList = renderParameters(fn.parameters, true);
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendSourceLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      appendSourceLine(`${fn.returnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    }
    if (callbackFunctions.length > 0 || mappedFunctions.some((fn) => !excludedNames.has(fn.name))) {
      appendSourceLine("");
    }
  }

  // Emit callback functions (e.g., interrupt handlers) before regular functions
  for (const callback of callbackFunctions) {
    // If debounce is configured, emit debounce wrapper
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      // Declare static variables for debounce timing
      appendSourceLine(`volatile unsigned long ${callback.name}_lastTime = 0;`);
      appendSourceLine(`const unsigned long ${callback.name}_debounce = ${callback.debounceMs};`);
      appendSourceLine("");
    }

    appendSourceLine(`${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}() {`);

    // Add debounce check if configured
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(`  volatile unsigned long now = ${strategy.currentTimeMillis()};`);
      appendSourceLine(`  if (now - ${callback.name}_lastTime < ${callback.name}_debounce) return;`);
      appendSourceLine(`  ${callback.name}_lastTime = now;`);
    }

    const callbackScope = createChildEmissionScope(topLevelScope);
    for (const stmt of callback.statements) {
      appendRenderedStatement(stmt, "  ", callbackScope);
    }
    appendSourceLine("}");
    appendSourceLine("");
  }

  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const declarationParameterList = renderParameters(fn.parameters, true);
    const definitionParameterList = renderParameters(fn.parameters, false);
    const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
    if (effectiveEmitMode === "split") {
      emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(line));
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendHeaderLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      appendHeaderLine(`${readonlyPrefix}${fn.returnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(line));
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(line));
    if (fn.typeParameters && fn.typeParameters.length > 0) {
      appendSourceLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
    }
    appendSourceLine(`${readonlyPrefix}${fn.returnType} ${fn.name}(${definitionParameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine("{");
    // Inject microtask pumping into the async driver function
    const asyncDriverFn = strategy.asyncDriverFunctionName();
    if (hasPromiseRuntime && fn.name === asyncDriverFn) {
      appendSourceLine("  typehal_pump_microtasks();");
    }
    // Async tasks are driven by their state machine; don't emit the blocking body.
    if (fn.isAsync && hasAsyncRuntime) {
      appendSourceLine(`  // driven as cooperative task in ${asyncDriverFn}()`);
    } else {
      // Emit static_assert for constrained type parameters
      if (fn.typeParameterConstraints) {
        for (const [param, expr] of fn.typeParameterConstraints) {
          appendSourceLine(`  static_assert(${expr}, "${param} constraint violated");`);
        }
      }
      const functionScope = createChildEmissionScope(topLevelScope, fn.parameters);

      // Switch to this function's C-array variable set (avoids name collisions
      // across functions where the same variable name can be a C array in one
      // function and a StaticArray in another).
      cArrayVarNames = fnCArrayVarNames.get(String(fi)) ?? new Set();

      // For the async driver function, emit async injection before the last return statement
      // so that the injection (e.g., thread spawn) is reachable.
      const isLoopDriver = fn.name === asyncDriverFn;
      const lastStmt = fn.statements.length > 0 ? fn.statements[fn.statements.length - 1] : null;
      const lastIsReturn = lastStmt?.kind === "return";

      // Emit all statements except the last if it's a return and we need to inject async
      const stmtsToEmit = (isLoopDriver && lastIsReturn)
        ? fn.statements.slice(0, -1)
        : fn.statements;

      for (const statement of stmtsToEmit) {
        appendRenderedStatement(statement, "  ", functionScope);
      }

      // Emit async loop injection before the final return
      if (isLoopDriver && (hasPromiseRuntime || asyncTaskClasses.length > 0 || usesTimers)) {
        const taskNames = asyncTaskClasses.map(t => t.taskVarName);
        const asyncConfig = strategy.getAsyncRuntimeConfig();
        
        // Ensure the config passed to the strategy reflects actual program usage
        asyncConfig.hasPromiseRuntime = hasPromiseRuntime;
        asyncConfig.hasTimers = usesTimers;

        const injectionLines = strategy.asyncLoopInjection(taskNames, asyncConfig);
        for (const line of injectionLines) {
          appendSourceLine(`  ${line}`);
        }
      }

      // Now emit the final return (if we deferred it)
      if (isLoopDriver && lastIsReturn) {
        appendRenderedStatement(lastStmt, "  ", functionScope);
      }
    }
    appendSourceLine("}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;
  if (effectiveEmitMode === "split") {
    // Add re-export includes to the header
    const finalHeaderLines = [...headerLines];
    const headerIncludeLines = dedupe([
      ...includes,
      ...headerIncludes,
    ]);
    if (headerIncludeLines.length > 0) {
      // Insert includes after #pragma once
      const includeLines = headerIncludeLines.map((inc) => `#include ${inc}`);
      finalHeaderLines.splice(1, 0, ...includeLines, "");
    }

    // Emit forward declarations for cross-module class types.
    // When a file references a class defined in another transpiled module
    // (e.g., as a pointer or parameter type), the compiler needs a forward
    // declaration if the header hasn't been included yet.
    if (options.crossModuleClasses && options.crossModuleClasses.size > 0) {
      // Collect class names defined in THIS file (no need to forward-declare own classes)
      const localClasses = new Set(program.classes.map(cls => cls.name));
      // Collect imported symbols that refer to cross-module classes
      const importedSymbols = new Set<string>();
      for (const imp of program.imports) {
        for (const sym of imp.namedImports) {
          importedSymbols.add(sym);
        }
      }
      const forwardDecls: string[] = [];
      for (const className of options.crossModuleClasses) {
        if (!localClasses.has(className) && importedSymbols.has(className)) {
          forwardDecls.push(`class ${className};`);
        }
      }
      if (forwardDecls.length > 0) {
        // Find the insertion point: after #pragma once, blank line, and includes
        // The header starts with "#pragma once" at index 0, then includes were
        // spliced in at index 1. Find the first non-include, non-blank line after includes.
        let insertIdx = 1;
        // Skip past any inserted include lines
        while (insertIdx < finalHeaderLines.length &&
          (finalHeaderLines[insertIdx].startsWith("#include") ||
            finalHeaderLines[insertIdx] === "")) {
          insertIdx++;
        }
        // Insert forward declarations with a blank line separator
        finalHeaderLines.splice(insertIdx, 0, ...forwardDecls, "");
      }
    }

    writeText(headerPath, finalHeaderLines.join("\n").trimEnd() + "\n");
    outputHeaderPath = headerPath;
    if (options.emitMaps) {
      outputHeaderMapPath = writeSourceMap(makeGeneratedMap(headerPath, program.fileName, headerMapEntries));
    }
  }

  // Non-entry Arduino files are emitted as header-only .h files
  if (sourceExtension === "h" && !isNpmPackage) {
    sourceLines.unshift("#pragma once", "");
  }

  // Post-process the final source for any remaining pointer member access
  // patterns that were not transformed earlier in the emitter.
  // Only transform lines AFTER the shim/polyfill block to avoid corrupting
  // platform polyfill code (e.g. strlen(s.buf) must not become strlen(s->buf)
  // when a user pointer variable is also named `s`).
  if (typeof globalPointerVarTypes !== "undefined" && globalPointerVarTypes.size > 0) {
    const pointerNames = Array.from(globalPointerVarTypes.keys()).filter((varName) => {
      const varType = globalPointerVarTypes.get(varName);
      return typeof varType === "string" && varType.trim().endsWith("*");
    });
    if (pointerNames.length > 0) {
      // Count shim + polyfill lines so we skip them during post-processing.
      const shimLineCount = shimLines.length + (shimLines.length > 0 ? 1 : 0); // +1 for trailing blank
      const polyfillLineCount = emittedPolyfills
        ? emittedPolyfills.declarations.join("\n").split("\n").length +
          emittedPolyfills.definitions.join("\n").split("\n").length
        : 0;
      const protectedLineCount = shimLineCount + polyfillLineCount;

      // Find the line index where user code starts (after includes + shim + polyfills)
      // The shim block is appended at a known point; scan for its end.
      let userCodeStartIdx = 0;
      for (let i = 0; i < sourceLines.length; i++) {
        const line = sourceLines[i];
        // The shim lines start with known patterns like "// TypeHAL Native Polyfills"
        // or struct definitions. We look for the last polyfill-related line.
        if (line.includes("// TypeHAL Native Polyfills") || line.includes("// String helpers")) {
          // Found the shim block start — user code begins after shimLineCount + some header lines
          userCodeStartIdx = i + protectedLineCount;
          break;
        }
      }

      // Apply the pointer -> transform only to user code lines
      if (userCodeStartIdx > 0 && userCodeStartIdx < sourceLines.length) {
        const protectedLines = sourceLines.slice(0, userCodeStartIdx);
        const userLines = sourceLines.slice(userCodeStartIdx);
        const userText = userLines.join("\n");
        const fixedUserText = pointerNames.reduce((text, varName) => {
          const pattern = new RegExp(`\\b${varName}\\.`, "g");
          return text.replace(pattern, `${varName}->`);
        }, userText);
        sourceLines = [...protectedLines, ...fixedUserText.split("\n")];
      }
    }
  }

  writeText(sourcePath, sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, sourceMapEntries))
    : undefined;

  const diagnostics: Diagnostic[] = [...program.diagnostics, ...profileDiagnostics];
  // Delegate any strategy-specific diagnostics (e.g. Arduino split-mode warning)
  diagnostics.push(...strategy.emitDiagnostics(options.emitMode));
  return {
    headerPath: outputHeaderPath,
    sourcePath,
    headerMapPath: outputHeaderMapPath,
    sourceMapPath: outputSourceMapPath,
    diagnostics,
    asyncTaskNames: asyncTaskClasses.map(t => t.taskVarName),
    usesTimers,
  };
}
