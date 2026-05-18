import path from "node:path";
import type { ProgramIR } from "@typehal/core";
import { filterPolyfillHelpers } from "@typehal/core/shared";
import { analyzeProgram } from "../../ir/program-analysis";
import { Diagnostic, EmitMode, SourceMapEntry } from "../../types";
import { ensureDir } from "../../utils/fs";
import { resolveImport } from "../../libdef/registry";
import { emitPolyfillBoilerplate } from "../native-helpers-emitter";
import { ResolvedNpmPackage } from "../../transpile/resolution";
import { resolveStrategy } from "../../platform/registry";
import { getLoadedFramework } from "../../framework-registry";
import {
  createEmissionScopeState,
  statementNeedsSnprintf,
} from "../snprintf-helpers";
import { ExpressionRenderer } from "../expression-renderer";
import { StatementRenderer } from "../statement-renderer";
import {
  isTypehalSDKImport,
  emitCommentLines,
  normalizeInclude,
  dedupe,
  applySymbolMap,
  generateAsyncTaskClass,
  hasConsoleCalls,
  resolveTranspiledModuleInclude,
} from "../utils";
import type {
  EmitterContext,
  EmitterOptions,
  MappedFunction,
  AsyncTaskClass,
} from "./emitter-context";

function resolveTemplateReturnType(
  returnType: string,
  typeParameters: string[] | undefined,
): string {
  if (!typeParameters || typeParameters.length === 0) return returnType;
  return returnType;
}

export function buildEmitterContext(
  program: ProgramIR,
  options: EmitterOptions,
): EmitterContext {
  const largeEnumNames = new Set<string>();
  const enumNames = new Set<string>();
  for (const e of program.enums) {
    enumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      largeEnumNames.add(e.name);
    }
  }
  const namespaceNames = new Set<string>();
  for (const ns of program.namespaces) {
    namespaceNames.add(ns.name);
    for (const e of ns.enums) {
      enumNames.add(e.name);
      if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
        largeEnumNames.add(e.name);
      }
    }
  }

  const strategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  strategy.setLargeEnumNames?.(largeEnumNames);
  const platformReservedNames = strategy.reservedNames();
  const reservedNames = strategy.reservedNames();

  ensureDir(options.outDir);

  const classNameMap = (() => {
    try {
      const framework = getLoadedFramework();
      if (framework.classNameMapBuilder) {
        return framework.classNameMapBuilder(program.imports);
      }
    } catch {
      // No loaded framework
    }
    return undefined;
  })();

  const programAnalysis = analyzeProgram(program, strategy);

  if (options.platformContext) {
    options.platformContext.analysis = programAnalysis;
    if (!options.platformContext.architecture && program.boardConstants) {
      options.platformContext.architecture = program.boardConstants.get("architecture") as string;
    }
  }

  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const baseName = options.npmPackage?.moduleKey
    || strategy.overrideBaseName(originalBaseName, outDirBaseName, options.isEntryFile ?? true, !!options.npmPackage);

  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const isrPrefix = isEntryFile ? 'main' : originalBaseName;
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];

  const isEntryFileForPolyfills = isEntryFile;
  const nativePolyfills = isEntryFileForPolyfills
    ? (strategy.generateNativePolyfills?.(program, options.platformContext) ?? [])
    : [];

  let filteredNativePolyfills = filterPolyfillHelpers(nativePolyfills, programAnalysis.usedPolyfillHelpers);
  if (!programAnalysis.hasThrowStatements) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "typehal_halt");
  }
  const usesTimers = programAnalysis.usedPolyfillHelpers.has('__tc_setInterval') ||
                     programAnalysis.usedPolyfillHelpers.has('__tc_setTimeout');
  if (!usesTimers) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "timer_methods");
  }

  const allPolyfills = filteredNativePolyfills;
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = program.functions.some(fn => fn.isAsync);
  const hasPromiseRuntime = nativePolyfills.some(
    (p) => p.id === "async_runtime" && (p as any).hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    if (isEntryFile) {
      shimLines = [...strategy.shimLines(program, options.platformContext)];
    }
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
    if (isTypehalSDKImport(imported.moduleSpecifier, program.fileName)) {
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

  const mappedFunctions: MappedFunction[] = program.functions.map((fn) => {
    const fnName = fn.originalName === "__typehal_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
    return {
      name: fnName,
      returnType: resolveTemplateReturnType(
        strategy.mapReturnType(fnName, fn.returnType),
        fn.typeParameters,
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
          return { ...stmt, callee: applySymbolMap(stmt.callee, symbolMap) };
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

  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const mapFunctionNameLocal = (originalName: string) =>
    statementRenderer.mapFunctionName(originalName);
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => mapFunctionNameLocal(fn.originalName))
  );

  const asyncTaskClasses: AsyncTaskClass[] = [];
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

  // Additional includes computed from analysis
  if (strategy.needsIostream() && programAnalysis.hasConsoleCalls) {
    includes.push("<iostream>");
  }
  const usesVectorTypes = programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral;
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
  if (program.requiredIncludes) {
    includes.push(...program.requiredIncludes);
  }

  // Placeholder defaults for fields that are computed later by other phases
  const noopFixPointer: (callee: string) => string = (c) => c;

  return {
    program,
    options,
    strategy,
    programAnalysis,
    enumNames,
    largeEnumNames,
    namespaceNames,
    symbolMap,
    includes,
    shimLines,
    baseName,
    effectiveEmitMode,
    isEntryFile,
    isNpmPackage,
    isrPrefix,
    platformReservedNames,
    reservedNames,
    knownFunctionReturnTypes,
    mappedFunctions,
    topLevelScope,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    exprRenderer,
    statementRenderer,
    classNameMap,
    boardConstants: program.boardConstants,
    asyncTaskClasses,
    asyncFunctionOriginalNames,
    asyncFunctionMappedNames,
    hasAsyncRuntime,
    hasPromiseRuntime,
    usesTimers,
    emittedPolyfills,
    sourceLines: [],
    headerLines: ["#pragma once", ""],
    sourceMapEntries: [],
    headerMapEntries: [],
    cArrayVarNames: new Set(),
    fnCArrayVarNames: new Map(),
    globalPointerVarTypes: new Map(),
    promotedVarDecls: new Map(),
    callbackFunctions: [],
    filteredTopLevelExecutables: [],
    filteredTopLevelDeclarations: [],
    emittedTopLevelStatements: [],
    compiletimeVarNames: new Set(),
    fixPointerFieldAccess: noopFixPointer,
    knownTopLevelObjectTypes: new Map(),
    knownTopLevelObjectFields: new Map(),
    profileDiagnostics,
    templateInterfaceNames,
    interfaceNamespaceMap,
  };
}
