import ts from "typescript";
import { parseSource } from "../ast/parse";
import { Diagnostic } from "../types";
import { EnumIR, ClassIR, FunctionIR, ImportIR, InterfaceIR, NamespaceIR, ProgramIR, ReExportIR, RegisterClassIR, StatementIR, TypeAliasIR } from "./model";
import { makeDiagnostic } from "./ast-node-utils";
import { buildFunctionReturnTypeMap, CppTypeHint } from "./type-resolution";
import { resolveBoardConstants, tryResolveBoardDefFile, BoardConstants } from "./board-resolver";
import { analyzePeripheralUsage, createEmptyPeripheralUsage, PeripheralUsage } from "./peripheral-usage";
import { runProgramValidations } from "./validation-orchestrator";
import { registerFieldMap, hoistedNestedFunctions, hoistedNestedClasses, hoistedNestedEnums, activeNamespaceNames, resetBuildState } from "./build-ir-state";
import { collectPointerVars, expressionStatementToIR, lowerStatement, variableStatementToIR } from "./statement-to-ir";
import { classDeclarationToIR, enumDeclarationToIR, interfaceDeclarationToIR, typeAliasDeclarationToIR } from "./declaration-builders";
import { namespaceToIR } from "./namespace-builder";
import { functionDeclarationToIR, variableAsFunctionToIR } from "./function-builder";

function normalizeLegacyArduinoSyntax(sourceText: string): string {
  return sourceText.replace(/\bfunction\s+void\s*\(/g, "function __arduino_setup__(");
}

export function buildProgramIR(fileName: string, sourceText: string, boardPackage?: string): ProgramIR {
  const normalizedSourceText = normalizeLegacyArduinoSyntax(sourceText);
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
  
  // Reset module-level state for this file
  resetBuildState();
  registerFieldMap.clear();
  
  // Collect pointer variables at top level (for correct -> vs . usage)
  // This also populates activeCArrayVars for typed array variables
  const topLevelPointerVars = collectPointerVars(source.statements);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliasNodes.set(statement.name.text, statement.type);
    }
  }

  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      imports.push({
        moduleSpecifier,
        namedImports: node.importClause.namedBindings.elements.map((e) => e.name.text),
      });
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
    // These are compile-time constructs for board packages - skip silently
    if (ts.isExportAssignment(node)) {
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
      }
      return;
    }

    // Handle enum declarations
    if (ts.isEnumDeclaration(node)) {
      const enumIR = enumDeclarationToIR(node, fileName, sourceText);
      if (enumIR) {
        enums.push(enumIR);
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

  // Resolve board-definition constants from the actual board package file.
  // This replaces the old hard-coded ARDUINO_BOARD_METADATA table in
  // typecode-map.ts so that Board.definition.* folds to the real values.
  let boardConstants: BoardConstants | undefined;
  for (const imp of imports) {
    const boardFile = tryResolveBoardDefFile(fileName, imp.moduleSpecifier, boardPackage);
    if (boardFile) {
      try {
        boardConstants = resolveBoardConstants(boardFile);
      } catch {
        // Non-fatal: missing or malformed board file — fall back to no-fold.
      }
      break;
    }
  }

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
    interfaces,
    namespaces,
  };
}
