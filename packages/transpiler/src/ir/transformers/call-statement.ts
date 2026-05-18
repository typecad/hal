import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR } from "@typehal/core";
import { PointerTracker, requiredIncludes, mutableArrayVars, nestedClassAliases, hoistedNestedClasses, topLevelClassNames, topLevelClasses } from "../build-ir-state";
import { extractNodeComments, makeSourceSpan } from "../ast-node-utils";
import { tryResolveHALMethod } from "./hal-call-resolver";
import { expressionToIR } from "../expression-to-ir";
import { escapeCppKeyword } from "../../utils/strings";
import { renderExprAsText, calleeToText } from "../render-expr";

export function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Map(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);

  // ---- HAL method resolver (highest priority) ---
  const halResolved = tryResolveHALMethod(call, fileName, sourceText, diagnostics, pointerVars);
  if (halResolved) return halResolved;

  // ── emit() — compile-time C++ injection ─────────────────────────────────
  if (ts.isIdentifier(call.expression) && call.expression.text === "emit") {
    return {
      kind: "call",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      callee: "__EMIT__",
      args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
    };
  }

  // ── include() — compile-time C++ header registration ─────────────────────
  if (ts.isIdentifier(call.expression) && call.expression.text === "include") {
    const firstArg = call.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      requiredIncludes.add(firstArg.text);
    }
    // Emit nothing in C++ — return empty block
    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── Array method translation: push → push_back, pop → pop_back ──────────
  if (ts.isPropertyAccessExpression(call.expression)) {
    const methodName = call.expression.name.text;
    const objExpr = call.expression.expression;
    if (ts.isIdentifier(objExpr) && mutableArrayVars.has(objExpr.text)) {
      if (methodName === "push") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.push`,
          args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
        };
      }
      if (methodName === "pop") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: `${objExpr.text}.pop`,
          args: [],
        };
      }
    }
  }

  // Format callee, using -> for pointer variables
  let calleeText: string;
  if (ts.isPropertyAccessExpression(call.expression)) {
    const objExpr = call.expression.expression;
    const methodName = escapeCppKeyword(call.expression.name.text);
    if (ts.isIdentifier(objExpr) && pointerVars.has(objExpr.text)) {
      calleeText = `${objExpr.text}->${methodName}`;
    } else if (ts.isCallExpression(objExpr) && ts.isPropertyAccessExpression(objExpr.expression)) {
      // Chained method call: obj.method1().method2()
      const innerReceiver = objExpr.expression.expression;
      const innerMethodName = objExpr.expression.name.text;
      const innerCallText = renderExprAsText(expressionToIR(objExpr, sourceText, diagnostics, pointerVars));
      let accessor = ".";
      if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
        let className = pointerVars.get(innerReceiver.text);
        if (className) className = nestedClassAliases.get(className) ?? className;
        const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
        const method = cls?.methods.find(m => m.name === innerMethodName);
        if (method && (method.returnType as string).endsWith("*")) {
          accessor = "->";
        }
      } else if (ts.isIdentifier(innerReceiver) && topLevelClassNames.has(innerReceiver.text)) {
        // Static method call on a top-level or cross-module class returning an instance
        const cls = topLevelClasses.get(innerReceiver.text);
        if (!cls) {
          // Cross-module class: factory methods typically return class instances (pointers)
          accessor = "->";
        } else {
          const chainMethod = cls.methods.find(m => m.name === innerMethodName);
          if (chainMethod && ((chainMethod.returnType as string).endsWith("*") || (chainMethod.returnType as string) === innerReceiver.text)) {
            accessor = "->";
          }
        }
      }
      calleeText = `${innerCallText}${accessor}${methodName}`;
    } else {
      calleeText = calleeToText(call.expression);
    }
  } else {
    calleeText = calleeToText(call.expression);
  }
  
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: call.arguments.map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
  };
}
