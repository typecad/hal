import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR } from "../../api";
import { PointerTracker, requiredIncludes, mutableArrayVars, nestedClassAliases, hoistedNestedClasses, topLevelClassNames, topLevelClasses, activeLocalTypes, activeGlobalTypes } from "../build-ir-state";
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

  // Handle super() calls in constructors - transform to super_call IR for class emitter
  if (call.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return {
      kind: "super_call",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
    };
  }

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

  // ── Map/Set method lowering: .set()/.get()/.has()/.delete()/.add() ──────
  if (ts.isPropertyAccessExpression(call.expression)) {
    const mapMethodName = call.expression.name.text;
    if ((mapMethodName === "set" || mapMethodName === "get" || mapMethodName === "has" || mapMethodName === "delete" || mapMethodName === "add") && call.arguments.length >= 1) {
      const mapReceiver = call.expression.expression;
      let receiverType: string | undefined;

      if (ts.isIdentifier(mapReceiver)) {
        receiverType = activeLocalTypes.get(mapReceiver.text) ?? activeGlobalTypes.get(mapReceiver.text);
      } else if (ts.isPropertyAccessExpression(mapReceiver) && mapReceiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
        receiverType = activeLocalTypes.get(`this->${mapReceiver.name.text}`);
      }

      if (receiverType && (receiverType.startsWith("std::map<") || receiverType.startsWith("std::set<"))) {
        const recIR = expressionToIR(mapReceiver, sourceText, diagnostics, pointerVars);
        const recText = renderExprAsText(recIR);
        const arg0IR = expressionToIR(call.arguments[0], sourceText, diagnostics, pointerVars);
        const arg0Text = renderExprAsText(arg0IR);

        if (receiverType.startsWith("std::map<") && mapMethodName === "set" && call.arguments.length >= 2) {
          const arg1IR = expressionToIR(call.arguments[1], sourceText, diagnostics, pointerVars);
          const arg1Text = renderExprAsText(arg1IR);
          return {
            kind: "assign" as const,
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            target: `${recText}[${arg0Text}]`,
            operator: "=",
            value: { kind: "raw" as const, value: arg1Text },
          };
        }
        if (receiverType.startsWith("std::map<") && mapMethodName === "get") {
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.at`,
            args: [{ kind: "raw" as const, value: arg0Text }],
          };
        }
        if ((receiverType.startsWith("std::map<") || receiverType.startsWith("std::set<")) && mapMethodName === "has") {
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.count`,
            args: [{ kind: "raw" as const, value: arg0Text }],
          };
        }
        if ((receiverType.startsWith("std::map<") || receiverType.startsWith("std::set<")) && mapMethodName === "delete") {
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.erase`,
            args: [{ kind: "raw" as const, value: arg0Text }],
          };
        }
        if (receiverType.startsWith("std::set<") && mapMethodName === "add") {
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.insert`,
            args: [{ kind: "raw" as const, value: arg0Text }],
          };
        }
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
      // Use expressionToIR for pointer-aware callee construction.
      // expressionToIR's call handler correctly resolves -> for pointer variables
      // and chained property access (e.g. s->player->printStats), avoiding
      // the dot-only calleeToText fallback.
      const callIR = expressionToIR(call, sourceText, diagnostics, pointerVars);
      if (callIR.kind === "method-call" && typeof callIR.callee === "string") {
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: callIR.callee,
          args: callIR.args,
        };
      }
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
