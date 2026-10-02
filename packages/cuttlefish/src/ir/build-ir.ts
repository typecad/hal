import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { parseSource } from "../ast/parse.js";
import { Diagnostic } from "../types.js";
import type { HALOpIR } from "../api/shared/hal-op-ir.js";
import { EnumIR, ClassIR, FunctionIR, ImportIR, InterfaceIR, NamespaceIR, ProgramIR, ReExportIR, RegisterClassIR, StatementIR, TypeAliasIR } from "../api/index.js";
import { isStringEnum } from "../api/shared/index.js";
import type { ParameterIR } from "../api/shared/ir-core.js";
import { makeDiagnostic, makeSourceSpan } from "./ast-node-utils.js";
import { buildFunctionReturnTypeMap, CppTypeHint, typeNodeToCppType, inlineTypeLiteralStructNames } from "./type-resolution.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import { tryResolveBoardDefFile, findGeneratedBoard, readGeneratedBoardConstants, BoardConstants } from "./board-resolver.js";
import { analyzePeripheralUsage, createEmptyPeripheralUsage, PeripheralUsage } from "./peripheral-usage.js";
import { runProgramValidations } from "./validation-orchestrator.js";
import { registerHalCtorInstance } from "./transformers/variables.js";
import { registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, activeNamespaceNames, activeEnumNames, activeStringEnumNames, arrayPushCounts, peripheralAliasMap, pinAliasMap, mcuPinForwardMap, mcuPinReverseMap, topLevelClassNames, topLevelInterfaceNames, objectTypeAliasNames, classTypeNames, topLevelClasses, requiredIncludes, resetBuildState, getCurrentBoardConstants, setCurrentBoardConstants, contextStorage, CompilationContext, registeredCallbacks, isrHandlerFunctions, getContext, discriminatedUnionVariantNames, restParamFunctions, topLevelAliasReceivers, userDeclaredVarNames,
  importNameAliases,
} from "./build-ir-state.js";
import { collectPointerVars, expressionStatementToIR, lowerStatement, variableStatementToIR, prescanArrayUsage, lowerStatementList } from "./statement-to-ir.js";
import { registerUIModuleImport, registerElementValue, recordClickHandler, recordBinding } from "./transformers/ui-call-resolver.js";
import { requireUIHook } from "../ui-hook.js";
import { autoWireElements, registerScreenId } from "./ui-element-auto-wire.js";
import { loadHALModules, halInstances, resetHALResolver } from "./hal-resolver.js";
import { prescanUnsupportedFeatures } from "./feature-prescan.js";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders.js";
import { namespaceToIR } from "./namespace-builder.js";
import { functionDeclarationToIR, variableAsFunctionToIR } from "./function-builder.js";

function normalizeEntrypointSyntax(sourceText: string): string {
  return sourceText.replace(/\bfunction\s+void\s*\(/g, "function __cuttlefish_entrypoint__(");
}

/**
 * Synthesize forwarding constructors for subclasses that declare none.
 *
 * C++ does not inherit constructors. A TS subclass `class B extends A {}` with
 * no explicit `constructor` previously lowered to a C++ class with NO
 * constructor at all, so `new B(args)` failed (`no matching function for call`)
 * and base parameter-property initialization was skipped. For each such
 * subclass we synthesize a constructor that mirrors the base's parameter
 * signature and forwards every argument via a synthesized `super_call`. If the
 * base is default-constructible (no constructor), we synthesize an empty
 * constructor so `new B()` still works.
 *
 * Bases may live in another file; they are resolved from the local `classes`
 * list first, then from `topLevelClasses` (which carries prebuilt/cross-file
 * ClassIR). Demo #14 Finding B.
 */
function synthesizeSubclassConstructors(classes: ClassIR[]): void {
  for (const cls of classes) {
    if (cls.constructor || !cls.extendsClass) continue;
    // The extendsClass text may carry template args (e.g. "Generic<std::string>");
    // the base class name is the identifier before any '<'.
    const baseName = cls.extendsClass.split("<")[0].trim();
    const base =
      classes.find((c) => c.name === baseName) ??
      topLevelClasses.get(baseName);
    if (!base) continue;

    if (base.constructor && base.constructor.parameters.length > 0) {
      // Mirror the base parameter list, forwarding each as a super_call arg.
      const fwdParams: ParameterIR[] = base.constructor.parameters.map((p) => ({
        name: p.name,
        cppType: p.cppType,
        defaultValue: p.defaultValue,
        isRest: p.isRest,
        ...(p.ownershipKind ? { ownershipKind: p.ownershipKind } : {}),
      }));
      const superArgs = base.constructor.parameters.map((p) => ({
        kind: "identifier" as const,
        value: p.name,
      }));
      const syntheticSpan = {
        filePath: cls.name,
        startOffset: 0,
        endOffset: 0,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      };
      cls.constructor = {
        parameters: fwdParams,
        statements: [
          {
            kind: "super_call",
            sourceSpan: syntheticSpan,
            args: superArgs,
          },
        ],
      };
    } else {
      // Base is default-constructible; synthesize an empty ctor so the
      // emitter produces `B() { }` rather than nothing.
      cls.constructor = { parameters: [], statements: [] };
    }
  }
}

function scanSourceForEnumNames(src: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:export\s+)?enum\s+(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function resolveRelativeImportPath(fromFile: string, moduleSpecifier: string): string | undefined {
  // .ui.html modules export no TS symbols (enums/functions) — skip them in the
  // early cross-module pre-scan so they aren't parsed as TypeScript.
  if (moduleSpecifier.endsWith(".ui.html")) return undefined;
  let normalized = moduleSpecifier;
  if (normalized.endsWith(".js")) normalized = normalized.slice(0, -3) + ".ts";
  else if (normalized.endsWith(".mjs")) normalized = normalized.slice(0, -5) + ".ts";
  const basePath = path.resolve(path.dirname(fromFile), normalized);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  return undefined;
}

/** Resolve a relative `.ui.html` import to its absolute path (for UI registration). */
function resolveUIImportPath(fromFile: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("..")) return undefined;
  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  if (basePath.toLowerCase().endsWith(".ui.html") && requireUIHook().getUIModule(basePath)) {
    return basePath;
  }
  try {
    if (fs.statSync(basePath).isFile() && basePath.toLowerCase().endsWith(".ui.html")) {
      return basePath;
    }
  } catch { /* skip */ }
  return undefined;
}

export function buildProgramIR(fileName: string, sourceText: string, boardTarget?: string, prebuiltClassMap?: Map<string, ClassIR>, prebuiltFunctionReturns?: Map<string, string>, prebuiltInterfaceNames?: Set<string>): ProgramIR {
  const parentStrategy = getContext().activeStrategy;
  return contextStorage.run(new CompilationContext(), () => {
    getContext().activeStrategy = parentStrategy;
    // Ensure HAL modules are loaded. transpile.ts warms the HAL registry once
    // per transpile run (before the per-file IR build), so this is normally a
    // cheap no-op. The non-forced call is a safety net for direct/test callers
    // of buildProgramIR that didn't warm the registry first.
    loadHALModules();
    const normalizedSourceText = normalizeEntrypointSyntax(sourceText);
  const source = parseSource(fileName, normalizedSourceText);
  const diagnostics: Diagnostic[] = [];
  // Expose the diagnostics sink on the context so deep IR-lowering helpers
  // (renderExprAsText, HAL fallbacks) that don't receive diagnostics as a
  // parameter can still report unsupported patterns. This is the same array
  // returned in ProgramIR.diagnostics, so throwIfFatalDiagnostics in
  // transpile.ts will abort the build on any error pushed here.
  getContext().diagnostics = diagnostics;
  // Only prescan user code — skip library sources from node_modules and
  // internal packages (the HAL package ships src/ for transpile-time
  // introspection, but its internal use of `any`, Promise, etc. is not
  // user code and should not trigger TS2CPP diagnostics).
  const normalizedFileName = fileName.replace(/\\/g, "/");
  if (!normalizedFileName.includes("/node_modules/") && !normalizedFileName.includes("/packages/")) {
    diagnostics.push(...prescanUnsupportedFeatures(source, normalizedSourceText));
  }
  const imports: ImportIR[] = [];
  const reExports: ReExportIR[] = [];
  const topLevelStatements: StatementIR[] = [];
  const functions: FunctionIR[] = [];
  const enums: EnumIR[] = [];
  const classes: ClassIR[] = [];
  const typeAliases: TypeAliasIR[] = [];
  const interfaces: InterfaceIR[] = [];
  const namespaces: NamespaceIR[] = [];
  const registerClasses: RegisterClassIR[] = [];
  const typeAliasNodes = new Map<string, ts.TypeNode>();
  const boilerplates = new Set<string>();
  // Reset module-level state for this file
  resetBuildState();
  // Cross-module free-function return types (transpile.ts Phase 0b pre-scan)
  // — seeded AFTER resetBuildState (which clears the context-bound map) so
  // the IR-time snprintf ladder can classify `${fn(x)}` interpolations by the
  // callee's real return type.
  if (prebuiltFunctionReturns) {
    for (const [name, cppType] of prebuiltFunctionReturns) {
      getContext().crossModuleFunctionReturns.set(name, cppType);
    }
  }
  // Cross-module interface names — an imported interface is pointer-typed
  // like a same-file one (see typeNodeToCppType); seed the per-file registry
  // AFTER resetBuildState so every file's IR build sees all of them.
  if (prebuiltInterfaceNames) {
    for (const name of prebuiltInterfaceNames) {
      topLevelInterfaceNames.add(name);
    }
  }
  // Same coverage for THIS file's own annotated top-level functions — direct
  // buildProgramIR callers (tests, tooling) don't run the transpile pre-scan,
  // and a same-file `${fn(x)}` needs the same classification.
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.type) {
      const ownReturnType = typeNodeToCppType(statement.type, typeAliasNodes);
      if (ownReturnType && ownReturnType !== "auto" && ownReturnType !== "void") {
        getContext().crossModuleFunctionReturns.set(statement.name.text, ownReturnType);
      }
      continue;
    }
    // A function-typed VARIABLE (`const f = (x): string => …`) is a callable
    // too — variableAsFunctionToIR lowers it to a free function, so the
    // template-literal ladder must classify `${f(x)}` the same way. Without
    // this, an arrow returning string formatted as %d (a pointer value).
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const fnExpr = ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)
          ? decl.initializer
          : undefined;
        if (!fnExpr || !fnExpr.type) continue;
        const fnReturnType = typeNodeToCppType(fnExpr.type, typeAliasNodes);
        if (fnReturnType && fnReturnType !== "auto" && fnReturnType !== "void") {
          getContext().crossModuleFunctionReturns.set(decl.name.text, fnReturnType);
        }
      }
    }
  }
  // Pre-scan every user-declared VARIABLE name (top-level, function params
  // and locals, for-of bindings) BEFORE lowering: reserved-name escaping at
  // identifier-IR creation needs the complete set up front — a reference in
  // a function body lowers before the top-level declaration that names it.
  userDeclaredVarNames.clear();
  const scanDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      userDeclaredVarNames.add(node.name.text);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      userDeclaredVarNames.add(node.name.text);
    }
    ts.forEachChild(node, scanDeclarations);
  };
  scanDeclarations(source);

  resetHALResolver();
  registerFieldMap.clear();  // Sink for HAL ops resolved to C++ text during this file's IR build (the
  // template-inlining seams). Lifted onto ProgramIR.resolvedHalOps below so
  // per-file scans see inlined ops; see CompilationContext.resolvedHalOpsSink.
  const resolvedHalOps: HALOpIR[] = [];
  getContext().resolvedHalOpsSink = resolvedHalOps;

  // Phase 0: Pre-scan for top-level classes and register them so type inference can resolve them.
  // Also register classes from other files in the transpile graph so that property accesses
  // on imported class instances are correctly typed (e.g. player.weaponName → std::string).
  if (prebuiltClassMap) {
    for (const [name, classIR] of prebuiltClassMap) {
      topLevelClassNames.add(name);
      classTypeNames.add(name);
      topLevelClasses.set(name, classIR);
    }
  }
  const localClassDeclarations = source.statements.filter(ts.isClassDeclaration);
  for (const statement of localClassDeclarations) {
    if (!statement.name) continue;
    topLevelClassNames.add(statement.name.text);
    classTypeNames.add(statement.name.text);
  }
  // Phase 0b: Pre-scan for top-level interface names. Interfaces lower to C++
  // structs (value types), so a variable of an interface type is a value —
  // never null. Registering the names here (before any statement lowering)
  // lets the null-comparison guard in expression-to-ir recognise such values
  // as value types. Demo #18 Finding A. Object-literal TYPE ALIASES
  // (`type Reading = { mv: number }`) lower to concrete value structs the
  // same way and register alongside — without this, `let r: Reading | null
  // = null; r === null` emitted `r == 0` against a struct (g++: no match
  // for operator==).
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name) {
      topLevelInterfaceNames.add(statement.name.text);
    }
    if (ts.isTypeAliasDeclaration(statement) && statement.name
      && ts.isTypeLiteralNode(statement.type)) {
      objectTypeAliasNames.add(statement.name.text);
    }
  }
  // Phase 0a-2: register this file's STRING enums BEFORE the class pre-scan
  // below. classDeclarationToIR resolves every member's annotated types, and
  // a string enum used as a type (`kind(): FieldKind`) maps to std::string
  // only when activeStringEnumNames already knows it — the pre-scan used to
  // run first, baking the raw enum name into method return types (and via
  // the "enum stress test" var branch, `const char*` locals) even though the
  // real pass re-lowered them correctly; the stale pre-scan IR answered
  // inferExprCppType for locals in OTHER files.
  for (const statement of source.statements) {
    if (!ts.isEnumDeclaration(statement) || !statement.name) continue;
    let any = false;
    let all = true;
    for (const member of statement.members) {
      if (member.initializer && ts.isStringLiteral(member.initializer)) any = true;
      else all = false;
    }
    if (any && all) {
      activeStringEnumNames.add(statement.name.text);
      activeEnumNames.add(statement.name.text);
    }
  }
  for (const statement of localClassDeclarations) {
    // We don't build full IR yet, just enough for type mapping. All local
    // names are already registered so forward and mutually recursive fields
    // use the same class-reference representation.
    const classIR = classDeclarationToIR(statement, fileName, sourceText, [], new Map(), new Map(), [], new Map());
    if (classIR) {
      topLevelClasses.set(classIR.name, classIR);
    }
  }

  // Phase 0c: Pre-scan top-level VARIABLE declarations and seed the globals
  // type map. In TS source order a class method may reference a module-level
  // variable declared LATER in the file (legal TS — methods run post-init);
  // lowering processes statements in order, so without this pre-pass the
  // method's IR build sees no type for the global and bakes member access
  // with the wrong separator (`stats.count()` on a SampleStats*, `c.name` on
  // a for-of loop var over a late-declared array). The real declaration
  // lowering later overwrites the entry with its final type (variables.ts
  // writes globals.set unconditionally), so a coarse pre-scan type is safe.
  // Collect the file's type-alias nodes FIRST: the pre-scan must resolve
  // alias-annotated declarations (`let current: Session | null`) through
  // them. With an empty map the union resolved to a stale `auto` stub, and
  // the while-body's locals fold wrote that stub OVER the declaration's
  // correct entry — the null-comparison guard then saw auto and emitted
  // `current != CUTTLEFISH_UNDEFINED` against a struct value.
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliasNodes.set(statement.name.text, statement.type);
      if (ts.isUnionTypeNode(statement.type) && statement.type.types.every(ts.isTypeLiteralNode)) {
        const variantNames = statement.type.types.map((_, i) => `_${statement.name.text}_Variant_${i}`);
        discriminatedUnionVariantNames.set(statement.name.text, variantNames);
      }
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.type === undefined && decl.initializer === undefined) continue;
      let hinted: CppTypeHint | undefined;
      if (decl.type) {
        hinted = typeNodeToCppType(decl.type, typeAliasNodes);
      } else if (decl.initializer) {
        const init = decl.initializer;
        if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
          if (init.expression.text === "Array"
            && init.typeArguments && init.typeArguments.length === 1) {
            hinted = `std::vector<${typeNodeToCppType(init.typeArguments[0], undefined)}>` as CppTypeHint;
          } else if (init.expression.text !== "Array") {
            hinted = `${init.expression.text}*` as CppTypeHint;
          }
        } else if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init)) {
          hinted = "std::string";
        } else if (ts.isNumericLiteral(init)) {
          hinted = "double";
        } else if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) {
          hinted = "bool";
        } else if (ts.isArrayLiteralExpression(init)) {
          hinted = "std::vector<double>" as CppTypeHint;
        }
      }
      if (hinted && hinted !== "auto") {
        getCurrentIrTypeScope()?.globals.set(decl.name.text, hinted);
      }
    }
  }

  const functionReturnTypes = buildFunctionReturnTypeMap(source);
  // Inline TYPE-LITERAL return annotations (`function f(): { a: number }`)
  // have no C++ name — typeNodeToCppType emits junk for them and the function
  // lowered to void ("return-statement with a value, in function returning
  // 'void'"). Synthesize a named struct alias per such function — the same
  // mechanism that gives object-literal vars a `_name_t` — register it in the
  // alias IR list (the type-decl emitter renders the struct) and override the
  // return-type map entry.
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.type) continue;
    // Only a GENUINELY INLINE annotation synthesizes. Resolving aliases here
    // (`: Reading` unwraps to Reading's type literal) made every alias-returning
    // function shadow its real return type with a synthetic struct — call
    // sites then passed _makeReading_ret_t where Reading was expected.
    if (!ts.isTypeLiteralNode(statement.type)) continue;
    const returnTypeNode = statement.type;
    const structName = `_${statement.name.text}_ret_t`;
    const structFields = returnTypeNode.members
      .filter(ts.isPropertySignature)
      .filter(m => ts.isIdentifier(m.name!))
      .map(m => ({
        name: (m.name as ts.Identifier).text,
        cppType: typeNodeToCppType(m.type, typeAliasNodes),
      }));
    if (structFields.length === 0) continue;
    typeAliases.push({
      name: structName,
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: [],
      trailingComments: [],
      cppType: structName,
      structFields,
    });
    functionReturnTypes.set(statement.name.text, structName as CppTypeHint);
  }
  // Inline TYPE-LITERAL parameter annotations (`function board(limit:
  // { take: number })`, class methods too) — the parameter twin of the return
  // synthesis above. Without it the annotation resolved "auto" which
  // normalizeTypeHintForUse collapses to "double", so `limit.take` in the
  // body failed at g++ ("request for member 'take' in 'limit', which is of
  // non-class type 'double'"). Synthesize `_<owner>_<param>_t`, register the
  // struct in the alias IR list, and map the literal NODE to the name so
  // every typeNodeToCppType call site (function-builder's parameter loops,
  // field inference) resolves it.
  const synthesizeLiteralParamStruct = (
    owner: string,
    parameter: ts.ParameterDeclaration,
  ): void => {
    if (!parameter.type || !ts.isTypeLiteralNode(parameter.type)) return;
    if (!ts.isIdentifier(parameter.name)) return;
    const structName = `_${owner}_${parameter.name.text}_t`;
    const structFields = parameter.type.members
      .filter(ts.isPropertySignature)
      .filter(m => ts.isIdentifier(m.name!))
      .map(m => ({
        name: (m.name as ts.Identifier).text,
        cppType: typeNodeToCppType(m.type, typeAliasNodes),
      }));
    if (structFields.length === 0) return;
    typeAliases.push({
      name: structName,
      sourceSpan: makeSourceSpan(parameter, fileName, sourceText),
      leadingComments: [],
      trailingComments: [],
      cppType: structName,
      structFields,
    });
    inlineTypeLiteralStructNames.set(parameter.type, structName);
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      for (const parameter of statement.parameters) {
        synthesizeLiteralParamStruct(statement.name.text, parameter);
      }
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        for (const parameter of member.parameters) {
          synthesizeLiteralParamStruct(`${statement.name.text}_${member.name.text}`, parameter);
        }
      }
    }
  }
  // Expose return types on the compilation context so UI callbacks / timers
  // can resolve helper types without every call site threading the map.
  getContext().activeFunctionReturnTypes.clear();
  for (const [name, type] of functionReturnTypes) {
    getContext().activeFunctionReturnTypes.set(name, type);
  }
  const topLevelVariableTypes = new Map<string, CppTypeHint>();
  let defaultExportName: string | undefined;

  // Pre-scan cross-module imports for enum names and function return types
  // so that inferExprCppType can resolve imported enum members and function calls.
  const earlyCrossModuleImports: ImportIR[] = [];
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const namedImports: string[] = [];
      const earlyAliases: Array<{ local: string; source: string }> = [];
      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const e of stmt.importClause.namedBindings.elements) {
          namedImports.push(e.name.text);
          if (e.propertyName && ts.isIdentifier(e.propertyName)) {
            earlyAliases.push({ local: e.name.text, source: e.propertyName.text });
            namedImports.push(e.propertyName.text); // source name for lookups
          }
        }
      }
      earlyCrossModuleImports.push({ moduleSpecifier: stmt.moduleSpecifier.text, namedImports, ...(earlyAliases.length > 0 ? { importAliases: earlyAliases } : {}) });
    }
  }
  for (const imp of earlyCrossModuleImports) {
    if (!imp.moduleSpecifier.startsWith('./') && !imp.moduleSpecifier.startsWith('../')) continue;
    const resolvedPath = resolveRelativeImportPath(fileName, imp.moduleSpecifier);
    if (!resolvedPath) continue;
    try {
      const importedSource = fs.readFileSync(resolvedPath, "utf8");
      const importedParsed = parseSource(resolvedPath, importedSource);
      const importedEnumNames = scanSourceForEnumNames(importedSource);
      // String-ness must travel with the name: an IMPORTED string enum used
      // as a type annotation (`get phase(): Phase`) maps to std::string at
      // typeNodeToCppType, which consults activeStringEnumNames — without
      // this registration the importing file's context didn't know Phase is
      // a string enum and emitted `Phase getPhase()` (a namespace, not a
      // type: g++ "'Phase' does not name a type").
      const collectImportedStringEnums = (node: ts.Node): void => {
        if (ts.isEnumDeclaration(node) && node.name) {
          let any = false;
          let all = true;
          for (const member of node.members) {
            if (member.initializer && ts.isStringLiteral(member.initializer)) any = true;
            else all = false;
          }
          if (any && all) importedEnumNames.add(`__string__:${node.name.text}`);
        }
        ts.forEachChild(node, collectImportedStringEnums);
      };
      collectImportedStringEnums(importedParsed);
      for (const name of imp.namedImports) {
        if (importedEnumNames.has(name)) {
          activeEnumNames.add(name);
        }
        if (importedEnumNames.has(`__string__:${name}`)) {
          activeStringEnumNames.add(name);
        }
      }
      const importedFnReturnTypes = buildFunctionReturnTypeMap(importedParsed);
      for (const [fnName, returnType] of importedFnReturnTypes) {
        if (imp.namedImports.includes(fnName) && returnType !== "auto") {
          functionReturnTypes.set(fnName, returnType);
        }
      }
      // Cross-module object-literal type aliases and interfaces: the
      // null-comparison fold classifies a value via
      // objectTypeAliasNames/topLevelInterfaceNames — a reading bound to a
      // cross-file `read(): DhtReading | null` stayed unclassifiable and the
      // compare emitted CUTTLEFISH_UNDEFINED against a value struct.
      const collectImportedAliases = (node: ts.Node): void => {
        if (ts.isTypeAliasDeclaration(node) && node.name
          && ts.isTypeLiteralNode(node.type)) {
          objectTypeAliasNames.add(node.name.text);
        }
        if (ts.isInterfaceDeclaration(node) && node.name) {
          topLevelInterfaceNames.add(node.name.text);
        }
        ts.forEachChild(node, collectImportedAliases);
      };
      collectImportedAliases(importedParsed);
    } catch {
      // Non-fatal — file might not be readable or parseable
    }
  }
  
  // Collect pointer variables at top level (for correct -> vs . usage)
  // This also populates activeCArrayVars for typed array variables
  const topLevelPointerVars = collectPointerVars(source.statements);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      // Mirror into the context snapshot — IR-side consumers without the
      // threaded map (the HAL snprintf ladder's struct-field resolution)
      // read it from there. (The threaded typeAliasNodes map was already
      // populated before Phase 0c — see the union-stub fix there.)
      getContext().typeAliasNodes.set(statement.name.text, statement.type);
      if (ts.isUnionTypeNode(statement.type) && statement.type.types.every(ts.isTypeLiteralNode)) {
        const variantNames = statement.type.types.map((_, i) => `_${statement.name.text}_Variant_${i}`);
        discriminatedUnionVariantNames.set(statement.name.text, variantNames);
      }
    }
  }

  // Pre-scan for mutable arrays (push/pop/indexOf) at top level. moduleScope
  // — these are the file's top-level statements, so their array literals are
  // module-level (cross-call accumulators; see moduleArrayLiteralVars).
  for (const statement of source.statements) {
    prescanArrayUsage(statement, true);
  }
  // …AND inside function/class bodies, BEFORE any module statement lowers.
  // A module-level array mutated from a function body (`journal.push(...)` in
  // logReading) used to register its mutation only when the FUNCTION lowered —
  // by then the module declaration had already promoted the array to
  // __tc_StaticArray (with a capacity counted from static push sites), while
  // every function-body access lowered through the std::vector path —
  // declaration and uses disagreed ("could not convert journal from
  // __tc_StaticArray<Reading,2> to std::vector<Reading>"). Scanning the bodies
  // here with function-scope semantics (moduleScope=false) completes
  // functionScopeMutatedArrays/moduleArrayLiteralVars in time: the array
  // stays std::vector everywhere.
  // Push COUNTS are restored after: each body re-scans (and re-counts) when
  // its own lowerStatementList runs — double-counting shifted bounded
  // StaticArray capacities (2 elements + 1 push + 2 slack = 5 became 6).
  {
    const savedPushCounts = new Map(arrayPushCounts);
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        for (const s of statement.body.statements) {
          prescanArrayUsage(s, false);
        }
      } else if (ts.isClassDeclaration(statement)) {
        for (const member of statement.members) {
          const body = (member as { body?: ts.Block }).body;
          if (body) {
            for (const s of body.statements) {
              prescanArrayUsage(s, false);
            }
          }
        }
      }
    }
    arrayPushCounts.clear();
    for (const [k, v] of savedPushCounts) {
      arrayPushCounts.set(k, v);
    }
  }

  // Resolve board-definition constants BEFORE IR building so the HAL resolver
  // can access them via currentBoardConstants during method body processing.
  // First pass: collect imports so we can find the board package.
  const earlyImports: ImportIR[] = [];
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const moduleSpecifier = stmt.moduleSpecifier.text;
      const namedImports: string[] = [];
      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        namedImports.push(...stmt.importClause.namedBindings.elements.map((e) => e.name.text));
      }
      // The `ui` namespace from @typecad/ui is a compile-time construct: its
      // calls (ui.mount/signal/bind) are intercepted by tryResolveUICall and
      // lowered to IR, but `ui` itself must NOT be emitted as a C++ value
      // (it would synthesize a bogus _ui_t struct). Drop it from the imports
      // IR so the emit path never sees it as an imported value.
      const isUiPackage = moduleSpecifier === '@typecad/ui';
      const filteredImports = isUiPackage
        ? namedImports.filter((n) => n !== 'ui')
        : namedImports;
      earlyImports.push({ moduleSpecifier, namedImports: filteredImports });
    }
  }
  for (const imp of earlyImports) {
    const boardFile = tryResolveBoardDefFile(fileName, imp.moduleSpecifier, boardTarget);
    if (boardFile) {
      try {
        setCurrentBoardConstants(readGeneratedBoardConstants(boardFile));
      } catch {
        // Non-fatal
      }
      break;
    }
  }
  // If no real board constants are loaded (the stand-in map from
  // getDefaultBoardConstants is empty), load the generated board manifest
  // directly — covers the case where board()/boardResolve() is imported from
  // @typecad/hal but no board-module import is present in the user's code.
  const currentBC = getCurrentBoardConstants();
  if (currentBC && currentBC.size <= 4) {
    const generated = findGeneratedBoard(fileName);
    if (generated) {
      try {
        setCurrentBoardConstants(readGeneratedBoardConstants(generated.boardJson));
      } catch {
        // Non-fatal
      }
    }
  }
  void boardTarget;

  // Phase 0c-bis: register UI module imports (name → .ui.html path) so
  // ui.mount(screen, ...) can resolve `screen` back to its source tree.
  // Only .ui.html specifiers are registered; their named imports are the UI
  // tree handles (e.g. `screen`).
  for (const imp of earlyImports) {
    if (!imp.moduleSpecifier.endsWith(".ui.html")) continue;
    const htmlPath = resolveUIImportPath(fileName, imp.moduleSpecifier);
    if (!htmlPath) continue;
    for (const name of imp.namedImports) {
      registerUIModuleImport(name, htmlPath);
      // Register each element in the tree for .value access
      const mod = requireUIHook().getUIModule(htmlPath);
      if (mod) {
        // Register screen IDs → indices for <a href="#screenId"> navigation.
        for (let si = 0; si < mod.allStyledScreens.length; si++) {
          const screenNode = mod.allStyledScreens[si] as any;
          if (screenNode.id) registerScreenId(screenNode.id, si);
        }
        // Register each element in ALL screens for .value access + auto-wire.
        const collectIds = (node: any) => {
          if (node.id) registerElementValue(name, node.id, htmlPath);
          node.children?.forEach(collectIds);
        };
        if (mod.allStyledScreens.length > 0) {
          let nextUiNodeIndex = 0;
          for (const screen of mod.allStyledScreens) {
            collectIds(screen);
            nextUiNodeIndex = autoWireElements(name, screen as any, nextUiNodeIndex);
          }
        } else {
          collectIds(mod.styled);
          autoWireElements(name, mod.styled as any, 0);
        }
      }
    }
  }

  // Phase 0d: record top-level HAL alias declarations (varName → receiver text)
  // in a cheap, resolution-free pass. `resolveHALReceiver` follows this map
  // lazily so a function that references an alias (`led.high()`) resolves it
  // even when declared before the `const led = LED.asOutput()` — making HAL
  // resolution order-independent (demo #34 Finding C). Only mode-SETTER calls
  // (which return the pin itself) are recorded; value-bearing reads are
  // excluded so their variables don't alias the pin (Finding B). The receiver
  // is resolved at lookup time (after imports have registered `LED` etc.), not
  // here, so import order doesn't matter.
  const HAL_ALIASING_METHODS = new Set([
    "asOutput", "asInput", "asInputPullUp", "asInputPullDown",
    "output", "inputPullUp", "inputPullDown",
    "device",  // I2CBus.device(addr) / SPIBus.device(cs) → device instance
    "begin",   // I2CBus.begin() / SPIBus.begin() → same instance
    "take",    // Bus.take() → same instance (ownership is compile-time only)
  ]);
  for (const node of source.statements) {
    if (!ts.isVariableStatement(node)) continue;
    for (const decl of node.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)
          && HAL_ALIASING_METHODS.has(init.expression.name.text)
          && ts.isIdentifier(init.expression.expression)) {
        // Capture call arguments for factory methods like device(0x76) that
        // need the arg to construct the derived instance (I2CTarget._address).
        const argTexts = init.arguments.map(a => {
          if (ts.isNumericLiteral(a)) return a.text;
          if (ts.isStringLiteral(a)) return a.text;
          if (ts.isIdentifier(a)) return a.text;
          return a.getText();
        });
        topLevelAliasReceivers.set(decl.name.text, { receiver: init.expression.expression.text, method: init.expression.name.text, args: argTexts });
      }
    }
  }

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const namedImports: string[] = [];
      let defaultImportName: string | undefined;

      // Handle default import: import X from "./module.js"
      if (node.importClause?.name && ts.isIdentifier(node.importClause.name)) {
        defaultImportName = node.importClause.name.text;
      }

      // Handle named imports: import { a, b } from "./module.js"
      const importAliases: Array<{ local: string; source: string }> = [];
      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const e of node.importClause.namedBindings.elements) {
          namedImports.push(e.name.text);
          // `import { runHelper as rh }` - register LOCAL -> SOURCE so call
          // sites lower under the exported definition's name and cross-module
          // reachability/declarations key on it (an unaliased lookup of the
          // local name found nothing: the module header never declared the
          // function and every call site had no binding).
          if (e.propertyName && ts.isIdentifier(e.propertyName)) {
            importAliases.push({ local: e.name.text, source: e.propertyName.text });
            importNameAliases.set(e.name.text, e.propertyName.text);
          }
        }
      }

      if (namedImports.length > 0 || defaultImportName) {
        imports.push({
          moduleSpecifier,
          namedImports,
          ...(importAliases.length > 0 ? { importAliases } : {}),
          ...(defaultImportName ? { defaultImportName } : {}),
        });
      }
      // Register PascalCase imports from relative modules as potential class names
      // so that static method calls (e.g., Button.start()) use the :: operator.
      if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
        for (const name of namedImports) {
          if (/^[A-Z]/.test(name)) {
            topLevelClassNames.add(name);
          }
        }
      }

      // Track HAL instances imported from the virtual board module — the
      // user-facing '@typecad/hal' specifier (mapped onto .typecad-hal/
      // board.ts by the project tsconfig), or a legacy
      // '@typecad/board-*' package import from pre-boardgen projects,
      // which resolves against the project's
      // generated board constants — so the HAL resolver can resolve them
      // to framework C++ names. Class imports from '@typecad/hal' fall
      // through every pattern below untouched. Case-insensitive.
      const lowerSpecifier = moduleSpecifier.toLowerCase();
      const isHALSource = lowerSpecifier.startsWith('@typecad/board-')
        || lowerSpecifier === '@typecad/hal';

      // UI authoring namespace: `import { ui } from "@typecad/ui"`. The `ui`
      // value is a compile-time construct (its calls are intercepted by
      // tryResolveUICall); it must NOT be emitted as a C++ struct/value.
      // Treat it like the HAL namespace imports (Pulse/Shift/Random): register
      // as a namespace name and skip, so no struct is synthesized.
      if (moduleSpecifier === '@typecad/ui') {
        for (const name of namedImports) {
          if (name === 'ui') {
            activeNamespaceNames.add(name);
          }
        }
      }

      if (isHALSource) {
        const boardConstants = getCurrentBoardConstants();
        const analogOffset = (boardConstants.get("pins.analogOffset") as number) ?? 14;

        for (const name of namedImports) {
          // Check if this name is a known pin alias (D0, A0, LED, etc.)
          // Transitively resolve aliases: LED -> D13 -> "13"
          let pinVal: string | undefined = pinAliasMap.get(name);
          if (pinVal) {
            // Resolve transitive aliases (e.g. LED -> D13 -> 13)
            while (pinVal && pinAliasMap.has(pinVal) && !/^\d+$/.test(pinVal)) {
              const nextVal: string | undefined = pinAliasMap.get(pinVal);
              if (!nextVal || nextVal === pinVal) break; // prevent infinite loop
              pinVal = nextVal;
            }
            const fields: Map<string, string> = new Map<string, string>([["_pin", pinVal as string]]);
            const portName = mcuPinReverseMap.get(pinVal);
            if (portName) fields.set("_port", portName);
            halInstances.set(name, { className: "Pin", fieldValues: fields });
            continue;
          }

          // D-pins: D0-D53 → Pin instance with MCU port name (fallback)
          const dMatch = name.match(/^D(\d+)$/);
          if (dMatch) {
            const fields = new Map([["_pin", dMatch[1]]]);
            const portName = mcuPinReverseMap.get(dMatch[1]);
            if (portName) fields.set("_port", portName);
            halInstances.set(name, { className: "Pin", fieldValues: fields });
            continue;
          }

          // A-pins: A0, A1, … → resolve through the board manifest's analog
          // pin list first (A-ordered on every board package: A<n> →
          // pins.analog[n] → the MCU port name → pin number). Only when the
          // list is absent (bare Arduino-style boards) fall back to the
          // analogOffset convention (A0 = 14) — on port-named boards that
          // fallback resolves A1 to a random GPIO (Black Pill PA15, a
          // non-analog pin, was the first to surface it via a capability
          // error).
          const aMatch = name.match(/^A(\d+)$/);
          if (aMatch) {
            let pinNum: string | undefined;
            // The flattener stores the manifest's analog pin list as a
            // comma-joined string under `pins.analog`.
            const analogList = boardConstants.get("pins.analog");
            if (typeof analogList === "string") {
              const analogName = analogList.split(",")[parseInt(aMatch[1], 10)];
              if (analogName) {
                const byName = mcuPinForwardMap.get(analogName);
                if (byName !== undefined) pinNum = String(byName);
              }
            }
            if (pinNum === undefined) {
              pinNum = String(analogOffset + parseInt(aMatch[1]));
            }
            const fields = new Map([["_pin", pinNum]]);
            const portName = mcuPinReverseMap.get(pinNum);
            if (portName) fields.set("_port", portName);
            halInstances.set(name, { className: "Pin", fieldValues: fields });
            continue;
          }

          // I2C buses: I2C0, I2C1, ...
          const i2cMatch = name.match(/^I2C(\d+)$/);
          if (i2cMatch) {
            const alias = peripheralAliasMap.get(name) ?? `I2C${i2cMatch[1]}`;
            halInstances.set(name, { className: "I2CBus", fieldValues: new Map([["_bus", alias]]) });
            continue;
          }

          // SPI buses: SPI0, SPI1, ...
          const spiMatch = name.match(/^SPI(\d+)$/);
          if (spiMatch) {
            const alias = peripheralAliasMap.get(name) ?? `SPI${spiMatch[1]}`;
            halInstances.set(name, { className: "SPIBus", fieldValues: new Map([["_bus", alias]]) });
            continue;
          }

          // UART: UART0, UART1, ... — the FUNCTIONAL thin UART instance, so
          // the board singleton is directly usable (UART0.println(...)) with
          // the same fields a `new UART('UART0')` construction captures
          // (port + the class's baud/ring defaults; variables.ts merges those
          // only at construction, so the registration carries them).
          const uartMatch = name.match(/^UART(\d+)$/);
          if (uartMatch) {
            const alias = peripheralAliasMap.get(name) ?? `UART${uartMatch[1]}`;
            halInstances.set(name, {
              className: "UART",
              fieldValues: new Map([["_port", alias], ["_bus", alias], ["_baud", "115200"], ["_rxBufferBytes", "64"]]),
            });
            continue;
          }

          // USB CDC serial ports: USB0, USB1, ...
          const usbMatch = name.match(/^USB(\d+)$/);
          if (usbMatch) {
            const alias = peripheralAliasMap.get(name) ?? `USB${usbMatch[1]}`;
            halInstances.set(name, { className: "USBConsole", fieldValues: new Map([["_port", alias]]) });
            continue;
          }

          // HAL namespace imports: Pulse, Shift, Random
          if (name === 'Pulse' || name === 'Shift' || name === 'Random') {
            activeNamespaceNames.add(name);
            continue;
          }
        }
      }
      return;
    }

  // PRE-REGISTER every top-level `const x = new <HALClass>(...)` into
  // halInstances BEFORE any function body lowers. Function declarations are
  // hoisted and lower first, and a HAL method call inside a function that ran
  // before its instance registered resolved against NOTHING — the fallback
  // half-inlined the method body with unsubstituted this-fields
  // (`adcReadMv(PA1, , , this->_channel…)`) and no diagnostic. Registration is
  // idempotent: the real declaration lowering re-runs it (and reports the
  // ctor diagnostics there — the prescan passes a throwaway sink).
  {
    const prescanDiagSink: Diagnostic[] = [];
    // THIN peripherals only: these are the classes whose method bodies inline
    // to ops with no downstream resolver, where a function-body use before
    // registration produced silent garbage. Composite classes (Request, BLE,
    // WiFi, Mqtt…) stage state onto their instance through the declaration
    // lowering itself and are perturbed by an early registration — their
    // function-body uses resolve through their own machinery.
    const prescanClasses = new Set([
      "GPIO", "PWM", "Servo", "ADC", "DAC", "Watchdog", "Counter",
      "I2CTarget", "SPITarget", "UART", "USBConsole", "Strip",
      "I2CResponder", "Power", "Clock", "CAN", "I2S",
    ]);
    const registerHalDecls = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNewExpression(decl.initializer)
            && ts.isIdentifier(decl.initializer.expression)
            && prescanClasses.has(decl.initializer.expression.text)) {
            registerHalCtorInstance(decl.name.text, decl.initializer, sourceText, prescanDiagSink);
          }
        }
      }
      ts.forEachChild(node, registerHalDecls);
    };
    registerHalDecls(source);
  }

    // Handle re-exports: export * from "./module.js" or export { a, b } from "./module.js"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const exportAll = !node.exportClause || !ts.isNamedExports(node.exportClause);
      const namedExports = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((e) => e.name.text)
        : undefined;
      
      reExports.push({
        moduleSpecifier,
        exportAll,
        namedExports,
      });
      return;
    }

    // Handle export default statements (ExportAssignment)
    if (ts.isExportAssignment(node)) {
      if (node.isExportEquals) {
        // export = X — board config style, skip
        return;
      }
      // export default <identifier> — record the name for default import resolution
      if (ts.isIdentifier(node.expression)) {
        defaultExportName = node.expression.text;
      } else if (ts.isFunctionExpression(node.expression) && node.expression.name) {
        // export default function name() { ... } — extract the function name.
        defaultExportName = node.expression.name.text;
      } else if (ts.isFunctionExpression(node.expression)) {
        // export default function() { ... } (anonymous) — synthesize a name.
        defaultExportName = "__default_export__";
      } else if (ts.isClassExpression(node.expression) && node.expression.name) {
        // export default class Name { ... } — extract the class name.
        defaultExportName = node.expression.name.text;
      } else if (ts.isClassExpression(node.expression)) {
        // export default class { ... } (anonymous) — synthesize a name.
        defaultExportName = "__default_export__";
      }
      // For export default function/class, the declaration is already processed
      // by the function/class handlers above — we just record the name.
      return;
    }

    // Handle namespace declarations
    if (ts.isModuleDeclaration(node)) {
      const nsIR = namespaceToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, registerClasses, topLevelPointerVars);
      if (nsIR) {
        namespaces.push(nsIR);
        activeNamespaceNames.add(nsIR.name);
      }
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      const fnIR = functionDeclarationToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, boilerplates, topLevelPointerVars, lowerStatementList);
      if (fnIR) {
        functions.push(fnIR);
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      // Check if all declarations are function expressions/arrow functions
      const fnResults = variableAsFunctionToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, boilerplates, topLevelPointerVars, lowerStatementList);
      if (fnResults) {
        functions.push(...fnResults);
        return;
      }

      topLevelStatements.push(
        ...variableStatementToIR(
          node,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          topLevelVariableTypes,
          typeAliasNodes,
          topLevelPointerVars,
          "",
          lowerStatementList,
        ),
      );
      return;
    }

    if (ts.isExpressionStatement(node)) {
      const lowered = expressionStatementToIR(
        node,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        topLevelVariableTypes,
        topLevelPointerVars,
      );
      if (lowered) {
        topLevelStatements.push(lowered);
      }
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const classIR = classDeclarationToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, registerClasses, topLevelPointerVars);
      if (classIR) {
        classes.push(classIR);
        topLevelClassNames.add(classIR.name);
        classTypeNames.add(classIR.name);
        topLevelClasses.set(classIR.name, classIR);
      }
      return;
    }

    // Handle enum declarations
    if (ts.isEnumDeclaration(node)) {
      const enumIR = enumDeclarationToIR(node, fileName, sourceText);
      if (enumIR) {
        enums.push(enumIR);
        activeEnumNames.add(enumIR.name);
        if (isStringEnum(enumIR)) {
          activeStringEnumNames.add(enumIR.name);
        }
      }
      return;
    }

  // Handle interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const ifaceIR = interfaceDeclarationToIR(node, fileName, sourceText, typeAliasNodes);
      if (ifaceIR) {
        interfaces.push(ifaceIR);
      }
      return;
    }

    // Handle type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      const aliasIR = typeAliasDeclarationToIR(node, fileName, sourceText, typeAliasNodes);
      if (aliasIR) {
        typeAliases.push(aliasIR);
      }
      return;
    }

    if (node.kind === ts.SyntaxKind.EndOfFileToken) {
      return;
    }

    // General fallthrough: lower any remaining statement types (while, for,
    // if, switch, do-while, etc.) that appear at the top level directly.
    {
      const lowered = lowerStatement(
        node as ts.Statement,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        topLevelVariableTypes,
        "<top-level>",
        typeAliasNodes,
        topLevelPointerVars,
      );
      if (lowered) {
        topLevelStatements.push(...lowered);
        return;
      }
    }

    diagnostics.push(
      makeDiagnostic(
        normalizedSourceText,
        node.pos,
        "Top-level node currently unsupported and skipped.",
        "error",
        "TS2CPP_UNSUPPORTED_TOPLEVEL",
      ),
    );
  });

  // Collect any nested functions that were hoisted during IR building
  functions.push(...hoistedNestedFunctions);

  // Collect any nested classes that were hoisted during IR building
  classes.push(...hoistedNestedClasses);

  // Synthesize forwarding constructors for subclasses that don't declare one.
  // A subclass `class B extends A {}` with no explicit constructor previously
  // emitted NO constructor, so `new B(args)` failed (no matching ctor) and any
  // base parameter-property initialization was lost. C++ has no implicit
  // inherited constructor: we must synthesize one that mirrors the base's
  // signature and forwards via a super_call. See demo #14 Finding B.
  synthesizeSubclassConstructors(classes);

  // Collect any nested enums that were hoisted during IR building
  enums.push(...hoistedNestedEnums);

  // Collect any local interface declarations that were hoisted during IR building
  for (const iface of hoistedNestedInterfaces) {
    if (!interfaces.some(i => i.name === iface.name)) {
      interfaces.push(iface);
    }
  }

  // Collect any local type alias declarations that were hoisted during IR building
  for (const alias of hoistedNestedTypeAliases) {
    if (!typeAliases.some(a => a.name === alias.name)) {
      typeAliases.push(alias);
    }
  }

  // Merge duplicate interface declarations (TS declaration merging)
  {
    const ifaceMap = new Map<string, InterfaceIR>();
    for (const iface of interfaces) {
      const existing = ifaceMap.get(iface.name);
      if (existing) {
        existing.fields.push(...iface.fields);
        existing.methods.push(...iface.methods);
      } else {
        ifaceMap.set(iface.name, { ...iface, fields: [...iface.fields], methods: [...iface.methods] });
      }
    }
    interfaces.length = 0;
    interfaces.push(...ifaceMap.values());
  }

  // Record top-level interface names. Interfaces lower to C++ structs (value
  // types), so a local/param of an interface type is a value — never null. The
  // null-comparison guard in expression-to-ir consults this set to recognise
  // such a value as a value type (topLevelClassNames holds only classes, which
  // are always pointer/reference types). Demo #18 Finding A.
  for (const iface of interfaces) {
    topLevelInterfaceNames.add(iface.name);
  }

  // Merge duplicate namespace declarations
  {
    const nsMap = new Map<string, NamespaceIR>();
    for (const ns of namespaces) {
      const existing = nsMap.get(ns.name);
      if (existing) {
        existing.enums.push(...ns.enums);
        existing.classes.push(...ns.classes);
        existing.functions.push(...ns.functions);
        existing.constants.push(...ns.constants);
        existing.interfaces.push(...ns.interfaces);
        existing.typeAliases.push(...ns.typeAliases);
      } else {
        nsMap.set(ns.name, {
          ...ns,
          enums: [...ns.enums],
          classes: [...ns.classes],
          functions: [...ns.functions],
          constants: [...ns.constants],
          interfaces: [...ns.interfaces],
          typeAliases: [...ns.typeAliases],
        });
      }
    }
    namespaces.length = 0;
    namespaces.push(...nsMap.values());
  }

  // Populate top-level class names for :: static method rendering
  for (const cls of classes) {
    topLevelClassNames.add(cls.name);
    classTypeNames.add(cls.name);
  }

  // Board constants were already resolved before IR building (for HAL resolver access).
  // Reuse the module-level value for the ProgramIR output.
  const boardConstants = getCurrentBoardConstants();

  // Analyze peripheral usage for optimization
  let peripheralUsage: PeripheralUsage;
  try {
    const partialProgram: ProgramIR = {
      fileName,
      imports,
      reExports,
      structs: [],
      enums,
      classes,
      typeAliases,
      registerClasses,
      topLevelStatements,
      functions,
      boilerplates,
      diagnostics,
      boardConstants,
      peripheralUsage: createEmptyPeripheralUsage(),
      interfaces,
      namespaces,
      // Include registeredCallbacks so interrupt-safety analysis can see
      // user ISR lambdas (onRising/onFalling/etc.) at validation time. The
      // callbackIR on each entry carries isInterruptHandler=true (set in
      // hal-emitter.ts); without this field the scanner's source (3) at
      // interrupt-analysis.ts:212 never iterates, so ISR unsafe-op detection
      // silently misses every user interrupt handler.
      registeredCallbacks: [...registeredCallbacks],
      // Same for named free functions used as handlers — their bodies are
      // only reachable through this list.
      isrHandlerFunctions: [...isrHandlerFunctions],
    };

    peripheralUsage = analyzePeripheralUsage(partialProgram);
    partialProgram.peripheralUsage = peripheralUsage;
    diagnostics.push(...runProgramValidations(partialProgram));
  } catch (e) {
    // If peripheral analysis fails, use empty usage
    peripheralUsage = createEmptyPeripheralUsage();
  }

  const program: ProgramIR = {
    fileName,
    imports,
    reExports,
    structs: [],
    enums,
    classes,
    typeAliases,
    registerClasses,
    topLevelStatements,
    functions,
    boilerplates,
    diagnostics,
    boardConstants,
    peripheralUsage,
    requiredIncludes: new Set(requiredIncludes),
    interfaces,
    namespaces,
    registeredCallbacks: [...registeredCallbacks],
    isrHandlerFunctions: [...isrHandlerFunctions],
    restParamFunctions: new Map(restParamFunctions),
    ...(resolvedHalOps.length > 0 ? { resolvedHalOps } : {}),
    ...(defaultExportName ? { defaultExportName } : {}),
  };

  // Output-pin state tracking. First bake the shadow-update flags into the
  // write/toggle ops, while this file's tracker state is still live (the
  // next file's build resets it, and emit runs after every file is built —
  // multi-file programs would lose the updates otherwise). Then consume the
  return program;
  });
}
