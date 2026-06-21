import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, ExpressionIR } from "../../api/index.js";
import { extractNodeComments, makeSourceSpan } from "../ast-node-utils.js";
import { registerFieldMap } from "../build-ir-state.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";

export function tryLowerRegisterWrite(
  statement: ts.ExpressionStatement,
  expr: ts.BinaryExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): StatementIR | null {
  if (ts.isPropertyAccessExpression(expr.left) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const objExpr = expr.left.expression;
    const fieldName = expr.left.name.text;
    if (ts.isIdentifier(objExpr)) {
      const regName = objExpr.text;
      const fieldMap = registerFieldMap.get(regName);
      if (fieldMap) {
        const field = fieldMap.get(fieldName);
        if (field) {
          const fieldMask = ((1 << field.width) - 1) >>> 0;
          const fieldMaskUL = fieldMask + 'UL';
          const shiftMask = (fieldMask << field.lo) >>> 0;
          const shiftMaskUL = shiftMask + 'UL';
          const valueIR = expressionToIR(expr.right, sourceText, diagnostics);
          const valueText = renderExprAsText(valueIR);
          const comments = extractNodeComments(statement, sourceText);
          return {
            kind: "assign",
            sourceSpan: makeSourceSpan(statement, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            target: `*${regName}`,
            operator: "=",
            value: { kind: "raw", value: `(*${regName} & ~${shiftMaskUL}) | ((${valueText} & ${fieldMaskUL}) << ${field.lo})` },
          };
        }
      }
    }
  }
  return null;
}

export function tryLowerRegisterRead(
  expr: ts.PropertyAccessExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
): ExpressionIR | null {
  if (ts.isIdentifier(expr.expression)) {
    const regName = expr.expression.text;
    const fieldName = expr.name.text;
    const fieldMap = registerFieldMap.get(regName);
    if (fieldMap) {
      const field = fieldMap.get(fieldName);
      if (field) {
        const mask = ((1 << field.width) - 1) >>> 0;
        const maskUL = mask + 'UL';
        if (field.lo === 0 && field.width === 1) {
          return { kind: "raw", value: `(*${regName} >> ${field.lo}) & 1UL` };
        }
        return { kind: "raw", value: `(*${regName} >> ${field.lo}) & ${maskUL}` };
      }
    }
  }
  return null;
}
