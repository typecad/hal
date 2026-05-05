import ts from "typescript";
import { parseSource } from "../ast/parse";
import { Diagnostic } from "../types";
import { EnumIR, ClassIR, FunctionIR, ImportIR, InterfaceIR, NamespaceIR, ProgramIR, ReExportIR, RegisterClassIR, StatementIR, TypeAliasIR } from "@typehal/core";
import { makeDiagnostic } from "./ast-node-utils";
import { buildFunctionReturnTypeMap, CppTypeHint } from "./type-resolution";
import { resolveBoardConstants, tryResolveBoardDefFile, BoardConstants } from "./board-resolver";
import { analyzePeripheralUsage, createEmptyPeripheralUsage, PeripheralUsage } from "./peripheral-usage";
import { runProgramValidations } from "./validation-orchestrator";
import { registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, hoistedNestedInterfaces, hoistedNestedTypeAliases, activeNamespaceNames, activeEnumNames, peripheralAliasMap, pinAliasMap, topLevelClassNames, topLevelClasses, requiredIncludes, resetBuildState, getCurrentBoardConstants, setCurrentBoardConstants } from "./build-ir-state";
import { collectPointerVars, expressionStatementToIR, lowerStatement, variableStatementToIR } from "./statement-to-ir";
import { loadHALModules, halInstances, resetHALResolver } from "./hal-resolver";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { namespaceToIR } from "./namespace-builder";
import { functionDeclarationToIR, variableAsFunctionToIR } from "./function-builder";

function normalizeEntrypointSyntax(sourceText: string): string {
  return sourceText.replace(/\bfunction\s+void\s*\(/g, "function __typehal_entrypoint__(");
}

export function buildProgramIR(fileName: string, sourceText: string, boardPackage?: string): ProgramIR {
  loadHALModules(true); // Parse HAL source files (force reload to pick up changes)
  const normalizedSourceText = normalizeEntrypointSyntax(sourceText);
  const source = parseSource(fileName, normalizedSourceText);
  const diagnostics: Diagnostic[] = [];
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
  const functionReturnTypes = buildFunctionReturnTypeMap(source);
  const topLevelVariableTypes = new Map<string, CppTypeHint>();
  let defaultExportName: string | undefined;
  
  // Reset module-level state for this file
  resetBuildState();
  resetHALResolver();
  registerFieldMap.clear();
  
  // Collect pointer variables at top level (for correct -> vs . usage)
  // This also populates activeCArrayVars for typed array variables
  const topLevelPointerVars = collectPointerVars(source.statements);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliasNodes.set(statement.name.text, statement.type);
    }
  }

  // Resolve board-definition constants BEFORE IR building so the HAL resolver
  // can access them via currentBoardConstants during method body processing.
  // First pass: collect imports so we can find the board package.
  const earlyImports: ImportIR[] = [];
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const namedImports: string[] = [];
      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        namedImports.push(...stmt.importClause.namedBindings.elements.map((e) => e.name.text));
      }
      earlyImports.push({ moduleSpecifier: stmt.moduleSpecifier.text, namedImports });
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
      const isHALSource = moduleSpecifier.startsWith('@typehal/board-')
        || moduleSpecifier === '@typehal/framework-arduino/arduino'
        || moduleSpecifier === '@typehal';

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
            halInstances.set(name, { className: "Pin", fieldValues: new Map<string, string>([["_pin", pinVal as string]]) });
            continue;
          }

          // D-pins: D0-D53 → Pin instance (fallback)
          const dMatch = name.match(/^D(\d+)$/);
          if (dMatch) {
            halInstances.set(name, { className: "Pin", fieldValues: new Map([["_pin", dMatch[1]]]) });
            continue;
          }

          // A-pins: A0-A19 → Pin instance with board-specific offset (fallback)
          const aMatch = name.match(/^A(\d+)$/);
          if (aMatch) {
            const pinNum = String(analogOffset + parseInt(aMatch[1]));
            halInstances.set(name, { className: "Pin", fieldValues: new Map([["_pin", pinNum]]) });
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
      }
      // For export default function/class, the declaration is already processed
      // by the function/class handlers above — we just record the name.
      return;
    }

    // Handle namespace declarations
    if (ts.isModuleDeclaration(node)) {
      const nsIR = namespaceToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, registerClasses);
      if (nsIR) {
        namespaces.push(nsIR);
        activeNamespaceNames.add(nsIR.name);
      }
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      const fnIR = functionDeclarationToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, boilerplates);
      if (fnIR) {
        functions.push(fnIR);
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      // Check if all declarations are function expressions/arrow functions
      const fnResults = variableAsFunctionToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, boilerplates);
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
      const classIR = classDeclarationToIR(node, fileName, sourceText, diagnostics, functionReturnTypes, typeAliasNodes, registerClasses);
      if (classIR) {
        classes.push(classIR);
        topLevelClassNames.add(classIR.name);
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
        "warning",
        "TS2CPP_UNSUPPORTED_TOPLEVEL",
      ),
    );
  });

  // Collect any nested functions that were hoisted during IR building
  functions.push(...hoistedNestedFunctions);

  // Collect any nested classes that were hoisted during IR building
  classes.push(...hoistedNestedClasses);

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

  // Populate top-level class names for :: static method rendering
  for (const cls of classes) {
    topLevelClassNames.add(cls.name);
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
    ...(defaultExportName ? { defaultExportName } : {}),
  };
}
