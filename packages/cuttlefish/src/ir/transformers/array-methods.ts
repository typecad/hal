import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR, ExpressionIR } from "../../api";
import { arrayLiteralSizes, mutableArrayVars, activeCArrayVars } from "../build-ir-state";
import { expressionToIR } from "../expression-to-ir";
import { renderExprAsText } from "../render-expr";

// Methods that require StaticArray promotion (not all are mutating — indexOf is read-only
// but needs StaticArray since C arrays don't have an indexOf method).
export const ARRAY_METHODS_REQUIRING_STATIC_ARRAY = new Set(["push", "pop", "indexOf"]);

export function prescanArrayUsage(statement: ts.Statement): void {
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          arrayLiteralSizes.set(decl.name.text, decl.initializer.elements.length);
        }
        prescanExprForArrayMethods(decl.initializer);
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isReturnStatement(statement) && statement.expression) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isIfStatement(statement)) {
    prescanArrayUsageBlock(statement.thenStatement);
    if (statement.elseStatement) prescanArrayUsageBlock(statement.elseStatement);
  } else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isBlock(statement)) {
    for (const s of statement.statements) prescanArrayUsage(s);
  }
}

function prescanArrayUsageBlock(stmt: ts.Statement): void {
  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) prescanArrayUsage(s);
  } else {
    prescanArrayUsage(stmt);
  }
}

export function prescanExprForArrayMethods(expr: ts.Expression): void {
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (ARRAY_METHODS_REQUIRING_STATIC_ARRAY.has(methodName) && ts.isIdentifier(expr.expression.expression)) {
      const varName = expr.expression.expression.text;
      if (arrayLiteralSizes.has(varName)) {
        mutableArrayVars.add(varName);
      }
    }
  }
}

export function buildInlineForLoop(
  span: any,
  srcSize: number,
  srcName: string,
  paramName: string,
  bodyExpr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  assignTarget: string,
  _isFilter: boolean,
): StatementIR {
  const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
  return {
    kind: "for",
    sourceSpan: span,
    initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
    condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
    increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
    body: [
      { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
        initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
      { kind: "assign", sourceSpan: span, target: assignTarget, operator: "=", value: bodyIR },
    ],
  };
}

export function tryLowerArrayAndStringMethods(
  expr: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: any,
): ExpressionIR | null {
  if (ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.expression)) {
    const receiverName = expr.expression.expression.text;
    const methodName = expr.expression.name.text;

    // ---- Array method translation for mutable arrays (StaticArray) -----------
    // Translate push → push_back, pop → pop_back, indexOf → indexOf at the expression level.
    if (mutableArrayVars.has(receiverName)) {
      if (methodName === "pop") {
        return { kind: "raw", value: `${receiverName}.pop()` };
      }
      if (methodName === "push") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${receiverName}.push(${argsText})` };
      }
      if (methodName === "indexOf") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${receiverName}.indexOf(${argsText})` };
      }
    }

    // ---- String indexOf wrapping (const char* needs String() on Arduino) ---
    if (methodName === "indexOf" &&
        !mutableArrayVars.has(receiverName) &&
        !activeCArrayVars.has(receiverName)) {
      return {
        kind: "method-call",
        callee: `${receiverName}.indexOf`,
        args: expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars))
      };
    }
  }

  return null;
}
