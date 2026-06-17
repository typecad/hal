import ts from "typescript";
import { Diagnostic, SourceSpan } from "../../types";
import { StatementIR, ExpressionIR, CppType } from "../../api";
import { extractNodeComments, makeSourceSpan } from "../ast-node-utils";
import { CppTypeHint, resolveDeclarationType, inferExprCppType } from "../type-resolution";
import { PointerTracker, nestedClassAliases } from "../build-ir-state";
import { expressionToIR } from "../expression-to-ir";
import { lowerStatementList, expressionStatementToIR } from "../statement-to-ir";
import { assignmentOperatorToString, updateLocalTypeFromAssignment, extractForInKeys } from "./variables";

export function forInitializerToIR(
  declarationList: ts.VariableDeclarationList,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  const storage: "var" | "let" | "const" =
    declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";

  const declaration = declarationList.declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }

  const declarationType = resolveDeclarationType(
    declaration.type,
    declaration.initializer,
    functionReturnTypes,
    localVariableTypes,
    undefined,
    sourceText,
  );

  localVariableTypes.set(declaration.name.text, declarationType.resolvedType);

  // Resolve type through nested class aliases for hoisted class names.
  let resolvedType: string = declarationType.resolvedType === "void" ? "auto" : declarationType.resolvedType;
  const isPointer = resolvedType.endsWith("*");
  const baseType = isPointer ? resolvedType.slice(0, -1) : resolvedType;
  if (nestedClassAliases.has(baseType)) {
    resolvedType = nestedClassAliases.get(baseType)! + (isPointer ? "*" : "");
  }

  return {
    kind: "var_decl",
    sourceSpan: makeSourceSpan(declaration, fileName, sourceText),
    name: declaration.name.text,
    storage,
    cppType: resolvedType as CppType,
    initializer: declaration.initializer
      ? expressionToIR(declaration.initializer, sourceText, diagnostics)
      : undefined,
  };
}

export function incrementorToIR(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR | undefined {
  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const valueType = inferExprCppType(expr.right, new Map(), localVariableTypes, sourceText);
      updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(expr, "", sourceText),
        target: expr.left.text,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  return undefined;
}

export function lowerControlFlowStatement(
  statement: ts.Statement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  functionNameForDiagnostics: string,
  typeAliases?: Map<string, ts.TypeNode>,
  pointerVars: PointerTracker = new Map(),
): StatementIR[] | null {
  if (ts.isReturnStatement(statement) && !statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      ...(functionReturnTypes.get(functionNameForDiagnostics) ? { functionReturnType: functionReturnTypes.get(functionNameForDiagnostics) } : {}),
    }];
  }

  if (ts.isReturnStatement(statement) && statement.expression) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "return",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      ...(functionReturnTypes.get(functionNameForDiagnostics) ? { functionReturnType: functionReturnTypes.get(functionNameForDiagnostics) } : {}),
    }];
  }

  if (ts.isWhileStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    return [{
      kind: "while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  if (ts.isIfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const thenStatements = lowerStatementList(
      ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    let elseBranch: StatementIR[] | undefined;
    if (statement.elseStatement) {
      elseBranch = lowerStatementList(
        ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement],
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
        typeAliases,
        pointerVars,
      );
    }

    return [{
      kind: "if",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      thenBranch: thenStatements,
      elseBranch,
    }];
  }

  if (ts.isForStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let initializer: StatementIR | undefined;
    if (statement.initializer) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        initializer = forInitializerToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
        );
      } else if (ts.isExpressionStatement(statement.initializer)) {
        const loweredExpr = expressionStatementToIR(
          statement.initializer,
          fileName,
          sourceText,
          diagnostics,
          functionReturnTypes,
          localVariableTypes,
          pointerVars,
        );
        initializer = loweredExpr;
      }
    }

    const condition = statement.condition
      ? expressionToIR(statement.condition, sourceText, diagnostics, pointerVars)
      : undefined;

    let increment: StatementIR | undefined;
    if (statement.incrementor) {
      increment = incrementorToIR(statement.incrementor, sourceText, diagnostics, localVariableTypes);
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    return [{
      kind: "for",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      initializer,
      condition,
      increment,
      body: bodyStatements,
    }];
  }

  if (ts.isForOfStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    // Resolve the iterable's element type so the loop variable carries a real
    // type (e.g. `Product*`) instead of `auto`. This must happen before
    // lowerStatementList for the body, which syncs localVariableTypes into
    // activeLocalTypes so member access (item->name) renders with `->`.
    if (variable && variable.kind === "var_decl") {
      const iterableType = inferExprCppType(
        statement.expression,
        functionReturnTypes,
        localVariableTypes,
        sourceText,
      );
      if (iterableType && iterableType.startsWith("std::vector<")) {
        const elementType = iterableType.slice("std::vector<".length, -1).trim();
        if (elementType && elementType !== "auto" && elementType !== "void") {
          variable.cppType = elementType as CppType;
          localVariableTypes.set(variable.name, elementType as CppTypeHint);
        }
      }
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    return [{
      kind: "for_of",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      iterable: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle for...in loops (iterates over object keys)
  if (ts.isForInStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);

    let variable: StatementIR | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      variable = forInitializerToIR(
        statement.initializer,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    }

    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    const keys = extractForInKeys(statement.expression);

    return [{
      kind: "for_in",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      variable: variable!,
      object: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      keys,
      body: bodyStatements,
    }];
  }

  if (ts.isBreakStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "break",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      label: statement.label?.text,
    }];
  }

  if (ts.isContinueStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "continue",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      label: statement.label?.text,
    }];
  }

  // Handle do...while loops
  if (ts.isDoStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    return [{
      kind: "do_while",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      body: bodyStatements,
    }];
  }

  // Handle switch statements
  if (ts.isSwitchStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const cases: Array<{ kind: "case"; sourceSpan: SourceSpan; leadingComments?: string[]; trailingComments?: string[]; value?: ExpressionIR; body: StatementIR[] }> = [];

    for (const clause of statement.caseBlock.clauses) {
      const caseComments = extractNodeComments(clause, sourceText);
      
      if (ts.isDefaultClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: undefined,  // default case has no value
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
            typeAliases,
            pointerVars,
          ),
        });
      } else if (ts.isCaseClause(clause)) {
        cases.push({
          kind: "case",
          sourceSpan: makeSourceSpan(clause, fileName, sourceText),
          leadingComments: caseComments.leadingComments,
          trailingComments: caseComments.trailingComments,
          value: expressionToIR(clause.expression, sourceText, diagnostics, pointerVars),
          body: lowerStatementList(
            clause.statements,
            fileName,
            sourceText,
            diagnostics,
            functionReturnTypes,
            localVariableTypes,
            functionNameForDiagnostics,
            typeAliases,
            pointerVars,
          ),
        });
      }
    }

    return [{
      kind: "switch",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      expression: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
      cases,
    }];
  }

  // Handle try/catch/finally statements
  if (ts.isTryStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const tryBlock = lowerStatementList(
      statement.tryBlock.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );

    let catchParam: string | undefined;
    let catchBlock: StatementIR[] | undefined;
    
    if (statement.catchClause) {
      if (statement.catchClause.variableDeclaration && ts.isIdentifier(statement.catchClause.variableDeclaration.name)) {
        catchParam = statement.catchClause.variableDeclaration.name.text;
      }
      catchBlock = lowerStatementList(
        statement.catchClause.block.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
        typeAliases,
        pointerVars,
      );
    }

    // Handle finally block
    let finallyBlock: StatementIR[] | undefined;
    if (statement.finallyBlock) {
      finallyBlock = lowerStatementList(
        statement.finallyBlock.statements,
        fileName,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
        functionNameForDiagnostics,
        typeAliases,
        pointerVars,
      );
    }

    return [{
      kind: "try",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
    }];
  }

  // Handle throw statements
  if (ts.isThrowStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    return [{
      kind: "throw",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value: expressionToIR(statement.expression, sourceText, diagnostics, pointerVars),
    }];
  }

  // Handle empty statements (just semicolons) - skip them silently
  if (ts.isEmptyStatement(statement)) {
    return [];
  }

  // Handle labeled statements (e.g., label: for (...))
  if (ts.isLabeledStatement(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const label = statement.label.text;
    const bodyStatements = lowerStatementList(
      ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement],
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );
    
    return [{
      kind: "labeled",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      label,
      body: bodyStatements,
    }];
  }

  // Handle standalone block statements
  if (ts.isBlock(statement)) {
    const comments = extractNodeComments(statement, sourceText);
    const bodyStatements = lowerStatementList(
      statement.statements,
      fileName,
      sourceText,
      diagnostics,
      functionReturnTypes,
      localVariableTypes,
      functionNameForDiagnostics,
      typeAliases,
      pointerVars,
    );
    
    return [{
      kind: "block",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: bodyStatements,
    }];
  }

  // Local interface declarations are type-only; no runtime IR needed
  if (ts.isInterfaceDeclaration(statement)) {
    return [];
  }

  // Local type alias declarations are type-only; no runtime IR needed
  if (ts.isTypeAliasDeclaration(statement)) {
    return [];
  }

  if (ts.isDebuggerStatement(statement)) {
    return [];
  }

  if (statement.kind === (ts.SyntaxKind as any).YieldExpression || (ts as any).isYieldExpression?.(statement)) {
    const yieldExpr = statement as any;
    const comments = extractNodeComments(statement, sourceText);
    const value = yieldExpr.expression
      ? expressionToIR(yieldExpr.expression as ts.Expression, sourceText, diagnostics, pointerVars)
      : undefined;
    return [{
      kind: "yield",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      value,
      isDelegate: !!yieldExpr.asteriskToken,
    }];
  }

  return null;
}
