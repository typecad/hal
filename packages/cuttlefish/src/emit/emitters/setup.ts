import path from "node:path";
import type { ProgramIR, StatementIR } from "../../api";
import { filterPolyfillHelpers, isStringEnum } from "../../api/shared";
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
  isCuttlefishSDKImport,
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

function filterShimBlock(lines: string[], startMarker: string, endMarker: string): string[] {
  const startIdx = lines.findIndex(l => l.includes(startMarker));
  if (startIdx === -1) return lines;
  const endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes(endMarker));
  if (endIdx === -1) return lines;
  const filtered = lines.slice();
  filtered.splice(startIdx, endIdx - startIdx + 1);
  while (filtered.length > 0 && filtered[startIdx] === '') {
    filtered.splice(startIdx, 1);
  }
  return filtered;
}

/**
 * Extract a `#ifndef MACRO ... #endif` include-guard block from a shim line
 * list. Used to emit just the macro definition (e.g. CUTTLEFISH_UNDEFINED) in
 * non-entry files of a split compilation, where the full helper shim belongs
 * to the entry file but the macro token is still referenced here.
 * Returns an empty array if no matching guard is found.
 */
function extractShimMacro(lines: string[], macroName: string): string[] {
  const ifndefIdx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed.startsWith('#ifndef') && trimmed.endsWith(macroName);
  });
  if (ifndefIdx === -1) return [];
  // Find the matching #endif that closes this guard.
  let depth = 1;
  let endIdx = -1;
  for (let i = ifndefIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#ifndef') || trimmed.startsWith('#ifdef')) depth++;
    else if (trimmed.startsWith('#endif')) {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return [];
  return lines.slice(ifndefIdx, endIdx + 1);
}

export function buildEmitterContext(
  program: ProgramIR,
  options: EmitterOptions,
): EmitterContext {
  const largeEnumNames = new Set<string>();
  const enumNames = new Set<string>();
  const stringEnumNames = new Set<string>();
  for (const e of program.enums) {
    enumNames.add(e.name);
    if (isStringEnum(e)) {
      stringEnumNames.add(e.name);
    }
    if (e.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768))) {
      largeEnumNames.add(e.name);
    }
  }
  const namespaceNames = new Set<string>();
  for (const ns of program.namespaces) {
    namespaceNames.add(ns.name);
    for (const e of ns.enums) {
      enumNames.add(e.name);
      if (isStringEnum(e)) {
        stringEnumNames.add(e.name);
      }
      if (e.members.some(m => typeof m.value === "number" && (m.value > 32767 || m.value < -32768))) {
        largeEnumNames.add(e.name);
      }
    }
  }
  if (options.crossModuleEnumNames) {
    for (const name of options.crossModuleEnumNames) {
      enumNames.add(name);
    }
  }
  if (options.crossModuleStringEnumNames) {
    for (const name of options.crossModuleStringEnumNames) {
      stringEnumNames.add(name);
    }
  }

  const strategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  strategy.setLargeEnumNames?.(largeEnumNames);
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
    : (strategy.generateNativePolyfills?.(program, options.platformContext) ?? []);

  let filteredNativePolyfills = filterPolyfillHelpers(nativePolyfills, programAnalysis.usedPolyfillHelpers);
  if (!programAnalysis.hasThrowStatements) {
    filteredNativePolyfills = filteredNativePolyfills.filter(p => p.id !== "cuttlefish_halt");
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
    (p) => p.id === "async_runtime" && p.hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    if (isEntryFile) {
      shimLines = [...strategy.shimLines(program, options.platformContext)];
    } else {
      // Non-entry files in split compilation: always emit the full shim
      // block. A class method body that uses `??` lowers to a
      // cuttlefish_nullish(...) call, but the helper lives in the entry
      // file's shim — which isn't visible from this header. We used to gate
      // this on programAnalysis.usesNullish, but that flag is unreliable:
      // the analysis runs before the expression renderer, which can
      // introduce cuttlefish_nullish calls (e.g. for default-param
      // destructuring, or `??` inside class methods on abstract bases)
      // that the analysis pass didn't see, leaving the header referencing
      // an undeclared helper. The shim is fully idempotent (#ifndef
      // guards), so emitting it unconditionally is safe and cheap.
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
    // Strip the nullish helper FUNCTIONS (not the CUTTLEFISH_UNDEFINED macro)
    // when the file doesn't actually emit cuttlefish_nullish(...) calls. A
    // file that only references `null`/`undefined` literals needs just the
    // macro token, not the function definitions. The usesNullishHelper flag
    // tracks files that lower `??` to cuttlefish_nullish(...) calls.
    //
    // Note: for split-file HEADERS, output-finalizer.ts separately injects
    // the full shim when the header's emitted lines contain an actual
    // cuttlefish_nullish( call (a more reliable post-emit check than the
    // per-file pre-emit analysis flag). The logic here governs the .cpp
    // source shim only.
    if (!programAnalysis.usesNullishHelper) {
      const filtered: string[] = [];
      for (let i = 0; i < shimLines.length; i++) {
        const l = shimLines[i];
        if (l.includes('cuttlefish_is_nullish') || l.includes('cuttlefish_exists') || l.includes('cuttlefish_nullish')) continue;
        filtered.push(l);
      }
      shimLines = filtered;
    }
    if (!programAnalysis.usesNum) {
      shimLines = filterShimBlock(shimLines, 'struct __tc_Num {', '} Num;');
    }
    if (!programAnalysis.usesTiming) {
      shimLines = filterShimBlock(shimLines, 'struct __tc_Timing {', '} Timing;');
    }
    if (!programAnalysis.usesWDT) {
      shimLines = filterShimBlock(shimLines, '#include <avr/wdt.h>', '} WDT;');
    }
    if (!programAnalysis.usesStrPtr) {
      shimLines = filterShimBlock(shimLines, '#ifndef CUTTLEFISH_STR_BUF_SIZE', 'inline size_t (strlen)(const char* s) { return ::strlen(s); }');
    }
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  for (const imported of program.imports) {
    if (isCuttlefishSDKImport(imported.moduleSpecifier, program.fileName)) {
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
  const interfaceFieldTypes = new Map<string, Map<string, string>>();
  // Shared map populated as top-level const object literals are emitted
  // (function-emitter-impl.ts) and read by the expression renderer to decide
  // `.` vs `::` member access on those variables.
  const knownTopLevelObjectTypes = new Map<string, string>();
  for (const iface of program.interfaces) {
    if (iface.parentScope) {
      interfaceNamespaceMap.set(iface.name, iface.parentScope);
    }
    if (iface.fields.length > 0) {
      const fieldTypes = new Map<string, string>();
      for (const field of iface.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      interfaceFieldTypes.set(iface.name, fieldTypes);
      for (const field of iface.fields) {
        if (/^[A-Z]$/.test(field.cppType)) {
          templateInterfaceNames.add(iface.name);
          break;
        }
      }
    }
  }
  for (const classDef of program.classes) {
    if (classDef.fields.length > 0 || classDef.extendsClass) {
      const fieldTypes = new Map<string, string>();
      if (classDef.extendsClass) {
        const parentFields = interfaceFieldTypes.get(classDef.extendsClass);
        if (parentFields) {
          for (const [fname, ftype] of parentFields) {
            fieldTypes.set(fname, ftype);
          }
        }
      }
      for (const field of classDef.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      interfaceFieldTypes.set(classDef.name, fieldTypes);
    }
  }
  if (options.crossModuleClassFieldTypes) {
    for (const [className, fieldTypes] of options.crossModuleClassFieldTypes) {
      if (!interfaceFieldTypes.has(className)) {
        interfaceFieldTypes.set(className, fieldTypes);
      }
    }
  }

  // Build the set of all known class names (local + cross-module).
  // Class instances are always created with `new`, which returns a pointer;
  // function parameters that reference these types must also be pointers.
  const classNames = new Set<string>();
  for (const cls of program.classes) classNames.add(cls.name);
  if (options.crossModuleClasses) {
    for (const name of options.crossModuleClasses) classNames.add(name);
  }

  const mappedFunctions: MappedFunction[] = program.functions.map((fn) => {
    const fnName = fn.originalName === "__cuttlefish_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
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
      isGenerator: fn.isGenerator,
      isExported: fn.isExported,
      statements: fn.statements.map((stmt) => {
        if (stmt.kind === "call") {
          return { ...stmt, callee: applySymbolMap(stmt.callee, symbolMap) };
        }
        return stmt;
      }),
    };
  });

  const knownFunctionReturnTypes = new Map<string, string>(options.crossModuleFunctionReturnTypes);
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    const fnName = fn.originalName === "__cuttlefish_entrypoint__" ? strategy.entrypointFunctionName() : fn.originalName;
    knownFunctionReturnTypes.set(fn.originalName, strategy.mapReturnType(fnName, fn.returnType));
  }
  // Also register class method return types (keyed by bare method name) so
  // downstream type inference — in particular snprintf format-specifier
  // selection for `this->method()` / `obj->method()` operands in a string
  // concat — can resolve a method's return type. Without this, a
  // double-returning method like `cargoUsed()` defaults to `%d` in the
  // emitted snprintf, which misaligns the format/arg list and corrupts
  // output. The bare-name key is safe here because `inferExpressionCppType`
  // looks up `expr.callee` which is the bare method name for member calls.
  for (const cls of program.classes) {
    for (const m of cls.methods) {
      if (!knownFunctionReturnTypes.has(m.name)) {
        knownFunctionReturnTypes.set(m.name, m.returnType);
      }
    }
    for (const g of cls.getters) {
      if (!knownFunctionReturnTypes.has(g.name)) {
        knownFunctionReturnTypes.set(g.name, g.returnType);
      }
    }
  }

  const snprintfCounter = { value: 0 };
  const topLevelScope = createEmissionScopeState();

  if (options.crossModuleVariableTypes) {
    for (const [name, cppType] of options.crossModuleVariableTypes) {
      topLevelScope.knownVariableTypes.set(name, { cppType });
    }
  }

  const stringVarNames = new Set<string>();
  // Pre-populate known string variable names from the program IR so that
  // string-concat / template rendering can detect string identifiers even when
  // the dynamic knownVariableTypes map doesn't yet hold them at render time.
  const isStringCppType = (t: string | undefined): boolean =>
    !!t && (t === "std::string" || t === "const char*");
  const collectStringVars = (statements: StatementIR[]): void => {
    for (const stmt of statements) {
      switch (stmt.kind) {
        case "var_decl":
          if (isStringCppType(stmt.cppType)) stringVarNames.add(stmt.name);
          break;
        case "if":
          collectStringVars(stmt.thenBranch);
          if (stmt.elseBranch) collectStringVars(stmt.elseBranch);
          break;
        case "for":
          if (stmt.initializer && stmt.initializer.kind === "var_decl" && isStringCppType(stmt.initializer.cppType)) {
            stringVarNames.add(stmt.initializer.name);
          }
          collectStringVars(stmt.body);
          break;
        case "for_of":
        case "for_in":
          if (stmt.variable && stmt.variable.kind === "var_decl" && isStringCppType(stmt.variable.cppType)) {
            stringVarNames.add(stmt.variable.name);
          }
          collectStringVars(stmt.body);
          break;
        case "while":
        case "do_while":
        case "block":
        case "labeled":
          collectStringVars(stmt.body);
          break;
        case "switch":
          for (const c of stmt.cases) collectStringVars(c.body);
          break;
        case "try":
          collectStringVars(stmt.tryBlock);
          if (stmt.catchBlock) collectStringVars(stmt.catchBlock);
          if (stmt.finallyBlock) collectStringVars(stmt.finallyBlock);
          break;
        default:
          break;
      }
    }
  };
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl" && isStringCppType(stmt.cppType)) stringVarNames.add(stmt.name);
  }
  for (const fn of program.functions) {
    for (const param of fn.parameters) {
      if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
    }
    collectStringVars(fn.statements);
  }
  for (const cls of program.classes) {
    for (const field of cls.fields) {
      if (isStringCppType(field.cppType)) stringVarNames.add(field.name);
    }
    for (const method of cls.methods) {
      for (const param of method.parameters) {
        if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
      }
      collectStringVars(method.statements);
    }
    if (cls.constructor) {
      for (const param of cls.constructor.parameters) {
        if (isStringCppType(param.cppType)) stringVarNames.add(param.name);
      }
      collectStringVars(cls.constructor.statements);
    }
  }
  const varAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();

  // Populate the variable → accessor map BEFORE constructing the renderers so
  // every emit pass (free functions, class methods, top-level code) sees the
  // full mapping. A getter read (`hero.alive`) must rewrite to `hero->getAlive()`
  // regardless of whether `hero` is a local, a free-function parameter, a class
  // method/ctor parameter, or a top-level binding. Previously only local
  // var_decls were registered (in class-emitter), which ran too late for the
  // free-function pass — leaving `hero->alive` unrewritten and failing g++.
  // See SUPPORT_MATRIX §4.3 (demo #4 fix).
  {
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
    const allVarDecls: { name: string; cppType: string }[] = [];
    for (const stmt of program.topLevelStatements) {
      if (stmt.kind === "var_decl") allVarDecls.push(stmt);
    }
    for (const fn of mappedFunctions) {
      for (const stmt of fn.statements) {
        if (stmt.kind === "var_decl") allVarDecls.push(stmt);
      }
      for (const param of fn.parameters) {
        allVarDecls.push({ name: param.name, cppType: param.cppType });
      }
    }
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const param of method.parameters) {
          allVarDecls.push({ name: param.name, cppType: param.cppType });
        }
      }
      if (cls.constructor) {
        for (const param of cls.constructor.parameters) {
          allVarDecls.push({ name: param.name, cppType: param.cppType });
        }
      }
    }
    for (const v of allVarDecls) {
      const bareType = v.cppType.replace(/\*$/, "").replace(/^const\s+/, "");
      const accessors = classAccessorNames.get(bareType);
      if (accessors) {
        varAccessorNames.set(v.name, accessors);
      }
    }
  }

  const exprRenderer = new ExpressionRenderer({
    strategy,
    boardConstants: program.boardConstants,
    classNameMap,
    enumNames,
    stringEnumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    interfaceFieldTypes,
    crossModuleClassNames: classNames,
    knownTopLevelObjectTypes,
  });

  const statementRenderer = new StatementRenderer({
    strategy,
    boardConstants: program.boardConstants,
    classNameMap,
    enumNames,
    stringEnumNames,
    largeEnumNames,
    knownFunctionReturnTypes,
    knownVariableTypes: topLevelScope.knownVariableTypes,
    namespaceNames,
    snprintfCounter,
    stringVarNames,
    varAccessorNames,
    interfaceFieldTypes,
    crossModuleClassNames: classNames,
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
              stringEnumNames,
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
  if (programAnalysis.usesStdMap) {
    includes.push("<map>");
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
  // String enums lower to const char* and use strcmp() for === comparisons.
  if (stringEnumNames.size > 0) {
    includes.push("<cstring>");
  }

  // Placeholder defaults for fields that are computed later by other phases
  const noopFixPointer: (callee: string) => string = (c) => c;

  return {
    program,
    options,
    strategy,
    programAnalysis,
    enumNames,
    stringEnumNames,
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
    restParamFunctions: program.restParamFunctions,
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
    knownTopLevelObjectTypes,
    knownTopLevelObjectFields: new Map(),
    profileDiagnostics,
    templateInterfaceNames,
    interfaceNamespaceMap,
    interfaceFieldTypes,
  };
}
