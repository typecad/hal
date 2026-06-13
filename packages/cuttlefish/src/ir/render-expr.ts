import ts from "typescript";
import { ExpressionIR } from "../api";
import { nestedFunctionAliases, getContext } from "./build-ir-state";
import { escapeCppKeyword } from "../utils/strings";

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
      if (expr.cppType === "float" || expr.cppType === "double" || !Number.isInteger(expr.value)) {
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
    case "element-access":
      return `${renderExprAsText(expr.object)}[${renderExprAsText(expr.index)}]`;
    case "tuple-access":
      return `std::get<${expr.index}>(${renderExprAsText(expr.object)})`;
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
    case "property-access": {
      const objText = renderExprAsText(expr.object);
      if (expr.isEnum || expr.isNamespace || expr.isStatic) {
        return `${objText}::${expr.property}`;
      }
      const isPointer = expr.isPointer || (expr.object.kind === "raw" && expr.object.value === "this");
      const sep = isPointer ? "->" : ".";
      return `${objText}${sep}${expr.property}`;
    }
    case "paren":
      return `(${renderExprAsText(expr.inner)})`;
    case "callback":
      return `/* __callback__ */`;
    case "lambda":
      return `/* __lambda__ */`;
    case "method-call": {
      const argsText = expr.args.map(a => renderExprAsText(a)).join(", ");
      return `${expr.callee}(${argsText})`;
    }
    case "template_string":
      return renderExprAsText(expr.expression);
    case "string_concat":
      return expr.parts.map(p => renderExprAsText(p)).join(" + ");
    case "hal-expr": {
      const strategy = getContext().activeStrategy;
      if (strategy?.resolveHALOperation) {
        const resolved = strategy.resolveHALOperation(expr.operation);
        if (resolved?.expression) return resolved.expression;
        if (resolved?.code) return resolved.code.replace(/;\s*$/, "");
      }
      return `/* unhandled hal-expr: ${expr.operation.operation} */`;
    }
    case "instanceof":
      return `(typeid(*${renderExprAsText(expr.object)}) == typeid(${expr.className}))`;
    case "spread_array":
      return renderExprAsText(expr.spreadExpr);
    default:
      return "0 /* unsupported_expr */";
  }
}
