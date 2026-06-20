import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { parseSource } from "../ast/parse";
import { Diagnostic } from "../types";
import { EnumIR, ClassIR, FunctionIR, ImportIR, InterfaceIR, NamespaceIR, ProgramIR, ReExportIR, RegisterClassIR, StatementIR, TypeAliasIR } from "../api";
import { isStringEnum } from "../api/shared";
import type { ParameterIR } from "../api/shared/ir-core";
import { makeDiagnostic } from "./ast-node-utils";
import { buildFunctionReturnTypeMap, CppTypeHint } from "./type-resolution";
import { resolveBoardConstants, tryResolveBoardDefFile, BoardConstants } from "./board-resolver";
import { analyzePeripheralUsage, createEmptyPeripheralUsage, PeripheralUsage } from "./peripheral-usage";
import { runProgramValidations } from "./validation-orchestrator";
import { registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, activeNamespaceNames, activeEnumNames, activeStringEnumNames, peripheralAliasMap, pinAliasMap, mcuPinReverseMap, topLevelClassNames, topLevelInterfaceNames, classTypeNames, topLevelClasses, requiredIncludes, resetBuildState, getCurrentBoardConstants, setCurrentBoardConstants, contextStorage, CompilationContext, registeredCallbacks, getContext, discriminatedUnionVariantNames, restParamFunctions, topLevelAliasReceivers } from "./build-ir-state";
import { collectPointerVars, expressionStatementToIR, lowerStatement, variableStatementToIR, prescanArrayUsage, lowerStatementList } from "./statement-to-ir";
import { registerUIModuleImport } from "./transformers/ui-call-resolver";
import { loadHALModules, halInstances, resetHALResolver } from "./hal-resolver";
import { prescanUnsupportedFeatures } from "./feature-prescan";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { namespaceToIR } from "./namespace-builder";
import { functionDeclarationToIR, variableAsFunctionToIR } from "./function-builder";

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
  try {
    if (fs.statSync(basePath).isFile() && basePath.toLowerCase().endsWith(".ui.html")) {
      return basePath;
    }
  } catch { /* skip */ }
  return undefined;
}

export function buildProgramIR(fileName: string, sourceText: string, boardPackage?: string, prebuiltClassMap?: Map<string, ClassIR>): ProgramIR {
  const parentStrategy = getContext().activeStrategy;
  return contextStorage.run(new CompilationContext(), () => {
    getContext().activeStrategy = parentStrategy;
    loadHALModules(true); // Parse HAL source files (force reload to pick up changes)
    const normalizedSourceText = normalizeEntrypointSyntax(sourceText);
  const source = parseSource(fileName, normalizedSourceText);
  const diagnostics: Diagnostic[] = [];
  // Expose the diagnostics sink on the context so deep IR-lowering helpers
  // (renderExprAsText, HAL fallbacks) that don't receive diagnostics as a
  // parameter can still report unsupported patterns. This is the same array
  // returned in ProgramIR.diagnostics, so throwIfFatalDiagnostics in
  // transpile.ts will abort the build on any error pushed here.
  getContext().diagnostics = diagnostics;
  diagnostics.push(...prescanUnsupportedFeatures(source, normalizedSourceText));
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
  resetHALResolver();
  registerFieldMap.clear();

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
  // as value types. Demo #18 Finding A.
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name) {
      topLevelInterfaceNames.add(statement.name.text);
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

  const functionReturnTypes = buildFunctionReturnTypeMap(source);
  const topLevelVariableTypes = new Map<string, CppTypeHint>();
  let defaultExportName: string | undefined;

  // Pre-scan cross-module imports for enum names and function return types
  // so that inferExprCppType can resolve imported enum members and function calls.
  const earlyCrossModuleImports: ImportIR[] = [];
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const namedImports: string[] = [];
      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        namedImports.push(...stmt.importClause.namedBindings.elements.map((e) => e.name.text));
      }
      earlyCrossModuleImports.push({ moduleSpecifier: stmt.moduleSpecifier.text, namedImports });
    }
  }
  for (const imp of earlyCrossModuleImports) {
    if (!imp.moduleSpecifier.startsWith('./') && !imp.moduleSpecifier.startsWith('../')) continue;
    const resolvedPath = resolveRelativeImportPath(fileName, imp.moduleSpecifier);
    if (!resolvedPath) continue;
    try {
      const importedSource = fs.readFileSync(resolvedPath, "utf8");
      const importedEnumNames = scanSourceForEnumNames(importedSource);
      for (const name of imp.namedImports) {
        if (importedEnumNames.has(name)) {
          activeEnumNames.add(name);
        }
      }
      const importedParsed = parseSource(resolvedPath, importedSource);
      const importedFnReturnTypes = buildFunctionReturnTypeMap(importedParsed);
      for (const [fnName, returnType] of importedFnReturnTypes) {
        if (imp.namedImports.includes(fnName) && returnType !== "auto") {
          functionReturnTypes.set(fnName, returnType);
        }
      }
    } catch {
      // Non-fatal — file might not be readable or parseable
    }
  }
  
  // Collect pointer variables at top level (for correct -> vs . usage)
  // This also populates activeCArrayVars for typed array variables
  const topLevelPointerVars = collectPointerVars(source.statements);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliasNodes.set(statement.name.text, statement.type);
      if (ts.isUnionTypeNode(statement.type) && statement.type.types.every(ts.isTypeLiteralNode)) {
        const variantNames = statement.type.types.map((_, i) => `_${statement.name.text}_Variant_${i}`);
        discriminatedUnionVariantNames.set(statement.name.text, variantNames);
      }
    }
  }

  // Pre-scan for mutable arrays (push/pop/indexOf) at top level
  for (const statement of source.statements) {
    prescanArrayUsage(statement);
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
      const isUiPackage = moduleSpecifier === '@typecad/ui' || moduleSpecifier === '@typecad/ui';
      const filteredImports = isUiPackage
        ? namedImports.filter((n) => n !== 'ui')
        : namedImports;
      earlyImports.push({ moduleSpecifier, namedImports: filteredImports });
    }
  }
  for (const imp of earlyImports) {
    const boardFile = tryResolveBoardDefFile(fileName, imp.moduleSpecifier, boardPackage);
    if (boardFile) {
      try {
        setCurrentBoardConstants(resolveBoardConstants(boardFile));
      } catch {
        // Non-fatal
      }
      break;
    }
  }

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
  ]);
  for (const node of source.statements) {
    if (!ts.isVariableStatement(node)) continue;
    for (const decl of node.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)
          && HAL_ALIASING_METHODS.has(init.expression.name.text)
          && ts.isIdentifier(init.expression.expression)) {
        topLevelAliasReceivers.set(decl.name.text, init.expression.expression.text);
      }
    }
  }

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const namedImports: string[] = [];
      let defaultImportName: string | undefined;

      // Handle default import: import X from "./module"
      if (node.importClause?.name && ts.isIdentifier(node.importClause.name)) {
        defaultImportName = node.importClause.name.text;
      }

      // Handle named imports: import { a, b } from "./module"
      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        namedImports.push(...node.importClause.namedBindings.elements.map((e) => e.name.text));
      }

      if (namedImports.length > 0 || defaultImportName) {
        imports.push({
          moduleSpecifier,
          namedImports,
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

      // Track HAL instances imported from board packages and framework stubs
      // so the HAL resolver can resolve them to Arduino C++ names.
      const isHALSource = moduleSpecifier.startsWith('@typecad/board-')
        || moduleSpecifier === '@typecad/framework-arduino/arduino'
        || moduleSpecifier === '@typecad';

      // UI authoring namespace: `import { ui } from "@typecad/ui"`. The `ui`
      // value is a compile-time construct (its calls are intercepted by
      // tryResolveUICall); it must NOT be emitted as a C++ struct/value.
      // Treat it like the HAL namespace imports (Pulse/Shift/Random): register
      // as a namespace name and skip, so no struct is synthesized.
      if (moduleSpecifier === '@typecad/ui' || moduleSpecifier === '@typecad/ui') {
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

          // A-pins: A0-A19 → Pin instance with board-specific offset and MCU port name (fallback)
          const aMatch = name.match(/^A(\d+)$/);
          if (aMatch) {
            const pinNum = String(analogOffset + parseInt(aMatch[1]));
            const fields = new Map([["_pin", pinNum]]);
            const portName = mcuPinReverseMap.get(pinNum);
            if (portName) fields.set("_port", portName);
            halInstances.set(name, { className: "Pin", fieldValues: fields });
            continue;
          }

          // I2C buses: I2C0, I2C1, ...
          const i2cMatch = name.match(/^I2C(\d+)$/);
          if (i2cMatch) {
            const alias = peripheralAliasMap.get(name) ?? (i2cMatch[1] === '0' ? 'Wire' : `Wire${i2cMatch[1]}`);
            halInstances.set(name, { className: "I2CBus", fieldValues: new Map([["_bus", alias]]) });
            continue;
          }

          // SPI buses: SPI0, SPI1, ...
          const spiMatch = name.match(/^SPI(\d+)$/);
          if (spiMatch) {
            const alias = peripheralAliasMap.get(name) ?? (spiMatch[1] === '0' ? 'SPI' : `SPI${spiMatch[1]}`);
            halInstances.set(name, { className: "SPIBus", fieldValues: new Map([["_bus", alias]]) });
            continue;
          }

          // UART: UART0, UART1, ...
          const uartMatch = name.match(/^UART(\d+)$/);
          if (uartMatch) {
            const alias = peripheralAliasMap.get(name) ?? (uartMatch[1] === '0' ? 'Serial' : `Serial${uartMatch[1]}`);
            halInstances.set(name, { className: "SerialPort", fieldValues: new Map([["_port", alias]]) });
            continue;
          }

          // HAL namespace imports: Pulse, Shift, Random
          if (name === 'Pulse' || name === 'Shift' || name === 'Random') {
            activeNamespaceNames.add(name);
            continue;
          }

          // HAL enum imports: BaudRate, I2CSpeed
          if (name === 'BaudRate' || name === 'I2CSpeed') {
            activeEnumNames.add(name);
            continue;
          }
        }
      }
      return;
    }

    // Handle re-exports: export * from "./module" or export { a, b } from "./module"
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
    };

    peripheralUsage = analyzePeripheralUsage(partialProgram);
    partialProgram.peripheralUsage = peripheralUsage;
    diagnostics.push(...runProgramValidations(partialProgram));
  } catch (e) {
    // If peripheral analysis fails, use empty usage
    peripheralUsage = createEmptyPeripheralUsage();
  }

  return {
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
    restParamFunctions: new Map(restParamFunctions),
    ...(defaultExportName ? { defaultExportName } : {}),
  };
  });
}
