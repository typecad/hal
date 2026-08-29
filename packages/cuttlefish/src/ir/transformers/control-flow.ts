import ts from "typescript";
import { Diagnostic, SourceSpan } from "../../types.js";
import { StatementIR, ExpressionIR, CppType } from "../../api/index.js";
import { extractNodeComments, makeSourceSpan } from "../ast-node-utils.js";
import { CppTypeHint, resolveDeclarationType, inferExprCppType } from "../type-resolution.js";
import { PointerTracker, nestedClassAliases, topLevelAliasReceivers } from "../build-ir-state.js";
import { type CppTypeIR, parseCppType, renderCppType, isPointer, parsedIsPointer, parsedIsVector, parsedElementString } from "../../api/shared/cpp-type-ir.js";
import { expressionToIR } from "../expression-to-ir.js";
import { lowerStatementList, expressionStatementToIR } from "../statement-to-ir.js";
import { assignmentOperatorToString, updateLocalTypeFromAssignment, extractForInKeys } from "./variables.js";

// Monotonic counter for synthetic for...of destructure loop variables.
let forOfDestructureCounter = 0;

/**
 * Build per-binding extraction statements for a for...of destructure loop
 * variable. For `for (const { x, y } of pts)` with synthetic loop var
 * `__forof_N`, produces:
 *   { kind: var_decl, name: "x", initializer: { property-access __forof_N.x } }
 *   { kind: var_decl, name: "y", initializer: { property-access __forof_N.y } }
 * and for array patterns `const [a, b]`, index-based extraction
 * (`__forof_N[0]`, `__forof_N[1]`). Each binding is registered in
 * localVariableTypes so the body sees it as a local. Used by the for...of
 * lowerer to desugar a binding-pattern loop variable (Finding A).
 */
function buildDestructureExtractions(
  pattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern,
  sourceName: string,
  sourceCppType: string,
  sourceSpan: SourceSpan,
  _sourceText: string,
  _diagnostics: Diagnostic[],
  _functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
): StatementIR[] {
  const extractions: StatementIR[] = [];
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (!ts.isIdentifier(element.name)) continue;
      const bindingName = element.name.text;
      const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : bindingName;
      const init: ExpressionIR = {
        kind: "property-access",
        object: { kind: "identifier", value: sourceName },
        property: propertyName,
        // The for...of synthetic loop var is a range-for reference (`const T&`),
        // so member access uses `.` (not `->`). isPointer must be false here
        // regardless of whether T is a class type.
        isPointer: false,
      };
      extractions.push({
        kind: "var_decl",
        sourceSpan,
        name: bindingName,
        storage: "const",
        cppType: "auto" as CppType,
        initializer: init,
      });
      localVariableTypes.set(bindingName, "auto" as CppTypeHint);
    }
  } else {
    // Array binding pattern: index-based extraction.
    let index = 0;
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) { index++; continue; }
      if (!ts.isIdentifier(element.name)) { index++; continue; }
      const bindingName = element.name.text;
      const init: ExpressionIR = {
        kind: "element-access",
        object: { kind: "identifier", value: sourceName },
        index: { kind: "number", value: index },
      };
      extractions.push({
        kind: "var_decl",
        sourceSpan,
        name: bindingName,
        storage: "const",
        cppType: "auto" as CppType,
        initializer: init,
      });
      localVariableTypes.set(bindingName, "auto" as CppTypeHint);
      index++;
    }
  }
  return extractions;
}

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
  {
    const ir = parseCppType(resolvedType);
    const ptr = isPointer(ir);
    const baseName = (() => {
      const b = ir.kind === "pointer" ? ir.base : ir;
      return b.kind === "named" ? b.name : renderCppType(b);
    })();
    if (nestedClassAliases.has(baseName)) {
      const aliasedIr: CppTypeIR = ptr
        ? { kind: "pointer", base: parseCppType(nestedClassAliases.get(baseName)!) }
        : parseCppType(nestedClassAliases.get(baseName)!);
      resolvedType = renderCppType(aliasedIr);
    }
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
    // Loop conditions/bodies may evaluate any number of times, so tracked
    // pin levels from before the loop are not valid inside it.
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
    // Branch merge: the level after the if must be the join of both branch
    // ends (pins that disagree become unknown). The condition is lowered
    // after the branches in this function but runs before them at runtime,
    // so the pre-branch state is restored before the condition is evaluated
    // and the merge is applied last.
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

    // Restore the pre-branch state before lowering the else branch and the
    // condition — both run before the branches at runtime... the condition
    // before them, the else on the path where the then branch never ran.

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

    // Evaluate the condition. If it's a bare identifier that resolves to a
    // HAL alias (e.g. `if (bus2)` where bus2 = I2C0.take()), the alias is a
    // compile-time non-null reference — constant-fold to `true` so the emit
    // layer never references the suppressed variable.
    let condition: ExpressionIR;
    if (ts.isIdentifier(statement.expression) && topLevelAliasReceivers.has(statement.expression.text)) {
      condition = { kind: "boolean", value: true };
    } else {
      condition = expressionToIR(statement.expression, sourceText, diagnostics, pointerVars);
    }

    return [{
      kind: "if",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      condition,
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

    // Loop conditions/bodies may evaluate any number of times, so tracked
    // pin levels from before the loop are not valid inside it.
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
    // Detect a destructuring loop variable: `for (const { x, y } of pts)`.
    // forInitializerToIR assumes an identifier name; a binding pattern has
    // none, so it would crash. Desugar at the IR level: a synthetic loop var
    // (`__forof_N`) carries the iterable element, and per-binding extraction
    // statements are prepended to the body (destructure stress test Finding A).
    let destructureExtractions: StatementIR[] = [];
    let isDestructureLoopVar = false;
    let bindingPattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern | undefined;
    if (ts.isVariableDeclarationList(statement.initializer)) {
      const decl = statement.initializer.declarations[0];
      if (decl && (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name))) {
        isDestructureLoopVar = true;
        bindingPattern = decl.name;
      }
    }

    if (isDestructureLoopVar && bindingPattern) {
      // Resolve the iterable's element type for the synthetic loop var.
      const iterableType = inferExprCppType(
        statement.expression,
        functionReturnTypes,
        localVariableTypes,
        sourceText,
      );
      const elementType =
        iterableType && parsedIsVector(iterableType)
          ? (parsedElementString(iterableType) as CppType)
          : ("auto" as CppType);
      const syntheticName = `__forof_${forOfDestructureCounter++}`;
      const forOfSpan = makeSourceSpan(statement, fileName, sourceText);
      variable = {
        kind: "var_decl",
        sourceSpan: forOfSpan,
        name: syntheticName,
        storage: "const",
        cppType: elementType,
        initializer: undefined,
      };
      localVariableTypes.set(syntheticName, elementType as CppTypeHint);
      // Build per-binding extraction statements.
      destructureExtractions = buildDestructureExtractions(
        bindingPattern,
        syntheticName,
        elementType,
        forOfSpan,
        sourceText,
        diagnostics,
        functionReturnTypes,
        localVariableTypes,
      );
    } else if (ts.isVariableDeclarationList(statement.initializer)) {
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
    // lowerStatementList for the body, which binds localVariableTypes as the
    // IrTypeScope's locals so member access (item->name) renders with `->`.
    if (variable && variable.kind === "var_decl" && !isDestructureLoopVar) {
      const iterableType = inferExprCppType(
        statement.expression,
        functionReturnTypes,
        localVariableTypes,
        sourceText,
      );
      if (iterableType && parsedIsVector(iterableType)) {
        const elementType = parsedElementString(iterableType);
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
      body: [...destructureExtractions, ...bodyStatements],
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
    // Loop bodies may run more than once; pre-loop pin levels are not valid
    // inside them.
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
    // Exactly one case runs at runtime, but all are lowered here; pin levels
    // from case bodies must not leak past the switch.
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
