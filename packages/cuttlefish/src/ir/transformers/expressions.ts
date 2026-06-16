import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR, ExpressionIR, CppType } from "../../api";
import { makeSourceSpan, extractNodeComments, makeDiagnostic } from "../ast-node-utils";
import { PointerTracker, arrayLiteralSizes } from "../build-ir-state";
import { expressionToIR } from "../expression-to-ir";
import { renderExprAsText } from "../render-expr";
import { CppTypeHint, inferExprCppType } from "../type-resolution";
import { tryLowerRegisterWrite } from "./register-assignment";
import { 
  assignmentOperatorToString, 
  updateLocalTypeFromAssignment, 
  callToStatement 
} from "../statement-to-ir";

export { expressionToIR } from "../expression-to-ir";

export function expressionStatementToIR(
  statement: ts.ExpressionStatement,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  functionReturnTypes: Map<string, CppTypeHint>,
  localVariableTypes: Map<string, CppTypeHint>,
  pointerVars: PointerTracker = new Map(),
): StatementIR | undefined {
  const expr = statement.expression;

  if (ts.isCallExpression(expr)) {
    return callToStatement(statement, expr, fileName, sourceText, diagnostics, pointerVars);
  }

  if (ts.isAwaitExpression(expr) && ts.isCallExpression(expr.expression)) {
    const callStmt = callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
    if (callStmt && callStmt.kind === "call") {
      return { ...callStmt, isAwaited: true };
    }
    return callStmt;
  }

  // ── Register bit-field write ────────────────────────────────────────
  if (ts.isBinaryExpression(expr)) {
    const regWrite = tryLowerRegisterWrite(statement, expr, fileName, sourceText, diagnostics);
    if (regWrite !== null) {
      return regWrite;
    }
  }

  // Handle this.field = value, obj.field = value, and compound assignments (+=, -=, etc.)
  if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);

      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
    // Handle ??= on a property-access left side: obj.field ??= val →
    // obj.field = cuttlefish_is_nullish(obj.field) ? val : obj.field
    // (demo #8 Finding I — was dropped because ??= isn't in the compound-assign
    // table, so the property-access assignment block returned nothing).
    if (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: "=",
        value: {
          kind: "ternary",
          condition: { kind: "raw", value: `cuttlefish_is_nullish(${targetText})` },
          whenTrue: valIR,
          whenFalse: { kind: "raw", value: targetText },
        },
      };
    }
    // Handle ||= on a property-access left side: obj.field ||= val →
    // obj.field = obj.field ? obj.field : val  (demo #13 Finding C)
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: "=",
        value: {
          kind: "ternary",
          condition: { kind: "raw", value: targetText },
          whenTrue: { kind: "raw", value: targetText },
          whenFalse: valIR,
        },
      };
    }
    // Handle &&= on a property-access left side: obj.field &&= val →
    // obj.field = obj.field ? val : obj.field  (demo #13 Finding C)
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: "=",
        value: {
          kind: "ternary",
          condition: { kind: "raw", value: targetText },
          whenTrue: valIR,
          whenFalse: { kind: "raw", value: targetText },
        },
      };
    }
  }
  if (ts.isBinaryExpression(expr) && ts.isElementAccessExpression(expr.left)) {
    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (operator) {
      const targetIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
      const targetText = renderExprAsText(targetIR);
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator,
        value: expressionToIR(expr.right, sourceText, diagnostics),
      };
    }
  }

  if (ts.isBinaryExpression(expr) && ts.isIdentifier(expr.left)) {
    // Handle ||= operator: x ||= val → x = (x == CUTTLEFISH_UNDEFINED) ? val : x;
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: {
          kind: "ternary",
          condition: {
            kind: "binary",
            operator: "==",
            left: { kind: "identifier", value: varName },
            right: { kind: "identifier", value: "CUTTLEFISH_UNDEFINED" },
          },
          whenTrue: valIR,
          whenFalse: { kind: "identifier", value: varName },
        },
      };
    }
    // Handle ??= operator: x ??= val → x = cuttlefish_is_nullish(x) ? val : x;
    if (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: {
          kind: "ternary",
          condition: {
            kind: "raw",
            value: `cuttlefish_is_nullish(${varName})`,
          },
          whenTrue: valIR,
          whenFalse: { kind: "identifier", value: varName },
        },
      };
    }
    // Handle &&= operator: x &&= val → if (x) x = val;
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "if",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        condition: { kind: "identifier", value: expr.left.text },
        thenBranch: [{
          kind: "assign",
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          target: expr.left.text,
          operator: "=",
          value: expressionToIR(expr.right, sourceText, diagnostics),
        }],
      };
    }

    if (expr.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      const valText = renderExprAsText(valIR);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: { kind: "raw", value: `pow(${varName}, ${valText})` },
      };
    }

    if (expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken) {
      const comments = extractNodeComments(statement, sourceText);
      const varName = expr.left.text;
      const valIR = expressionToIR(expr.right, sourceText, diagnostics);
      const valText = renderExprAsText(valIR);
      return {
        kind: "assign",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: varName,
        operator: "=",
        value: { kind: "raw", value: `static_cast<unsigned int>(static_cast<unsigned int>(${varName}) >> ${valText})` },
      };
    }

    const operator = assignmentOperatorToString(expr.operatorToken.kind);
    if (!operator) {
      return undefined;
    }

    if (pointerVars.has(expr.left.text) && operator === "=") {
      const rightExpr = expr.right;
      const isReassigningNew = ts.isNewExpression(rightExpr);
      if (!isReassigningNew) {
        diagnostics.push(
          makeDiagnostic(
            sourceText,
            statement.pos,
            `Variable '${expr.left.text}' was declared with 'new' but is being reassigned; pointer semantics may be incorrect.`,
            "warning",
            "TS2CPP_PTR_REASSIGN",
          ),
        );
      }
    }

    const valueType = inferExprCppType(expr.right, functionReturnTypes, localVariableTypes, sourceText);
    updateLocalTypeFromAssignment(expr.left.text, operator, valueType, localVariableTypes);
    const comments = extractNodeComments(statement, sourceText);

    return {
      kind: "assign",
      sourceSpan: makeSourceSpan(statement, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      target: expr.left.text,
      operator,
      value: expressionToIR(expr.right, sourceText, diagnostics),
    };
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isPostfixUnaryExpression(expr) && ts.isIdentifier(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: expr.operand.text,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isPropertyAccessExpression(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      const targetIR = expressionToIR(expr.operand, sourceText, diagnostics);
      const targetText = renderExprAsText(targetIR);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isPostfixUnaryExpression(expr) && ts.isPropertyAccessExpression(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      const targetIR = expressionToIR(expr.operand, sourceText, diagnostics);
      const targetText = renderExprAsText(targetIR);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  if (ts.isPrefixUnaryExpression(expr) && ts.isElementAccessExpression(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      const targetIR = expressionToIR(expr.operand, sourceText, diagnostics);
      const targetText = renderExprAsText(targetIR);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: true,
      };
    }
  }

  if (ts.isPostfixUnaryExpression(expr) && ts.isElementAccessExpression(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const comments = extractNodeComments(statement, sourceText);
      const targetIR = expressionToIR(expr.operand, sourceText, diagnostics);
      const targetText = renderExprAsText(targetIR);
      return {
        kind: "update",
        sourceSpan: makeSourceSpan(statement, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        target: targetText,
        operator: expr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--",
        prefix: false,
      };
    }
  }

  return undefined;
}
