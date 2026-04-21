import ts from "typescript";
import { ExpressionIR } from "./model";
import { nestedFunctionAliases } from "./build-ir-state";

export function calleeToText(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) {
    const alias = nestedFunctionAliases.get(expr.text);
    return alias ?? expr.text;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return `${calleeToText(expr.expression as ts.LeftHandSideExpression)}.${expr.name.text}`;
  }

  return expr.getText();
}

export function renderExprAsText(expr: ExpressionIR): string {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        return str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
      }
      return `${expr.value}`;
    }
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier":
      return expr.value;
    case "raw":
      return expr.value;
    case "await":
      return renderExprAsText(expr.value);
    case "ternary":
      return `(${renderExprAsText(expr.condition)} ? ${renderExprAsText(expr.whenTrue)} : ${renderExprAsText(expr.whenFalse)})`;
    case "array":
      const elements = expr.elements.map((e) => renderExprAsText(e)).join(", ");
      return `{ ${elements} }`;
    case "object":
      const fieldValues = expr.fields.map((f) => `${renderExprAsText(f.value)}`).join(", ");
      return `{ ${fieldValues} }`;
    case "binary":
      return `${renderExprAsText(expr.left)} ${expr.operator} ${renderExprAsText(expr.right)}`;
    case "unary":
      return `${expr.operator}${renderExprAsText(expr.operand)}`;
    case "property-access":
      return `${renderExprAsText(expr.object)}.${expr.property}`;
    case "paren":
      return `(${renderExprAsText(expr.inner)})`;
    case "typecode-call":
      // Fallback text rendering used inside build-ir.ts only.
      // The real Arduino translation happens in renderExpression (cpp-emitter.ts).
      return `${expr.receiver}.${expr.method}(${expr.args.map(renderExprAsText).join(', ')})`;
    case "callback":
      return `/* __callback__ */`;
    case "lambda":
      return `/* __lambda__ */`;
    case "method-call": {
      const argsText = expr.args.map(a => renderExprAsText(a)).join(", ");
      return `${expr.callee}(${argsText})`;
    }
    default:
      return "0 /* unsupported_expr */";
  }
}
