import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { HALOpIR, StatementIR, ExpressionIR } from "../../api/index.js";
import { makeSourceSpan } from "../ast-node-utils.js";
import { expressionToIR } from "../expression-to-ir.js";
import { resolveHALReceiver, processHALMethodBody } from "../hal-resolver.js";
import { PointerTracker } from "../build-ir-state.js";

/**
 * Recursively collect emit lines from chained HAL method calls.
 * For an expression like rgb.brightness(50).show(), this collects
 * the emit lines from the inner rgb.brightness(50) call.
 */
export function collectChainedHALEmits(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
  emitLines: string[],
  halOps: HALOpIR[] = [],
): void {
  // Chained call: led.tone(440).for(400) — the receiver is the inner call led.tone(440)
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const method = expr.expression.name.text;
    const innerReceiver = expr.expression.expression;

    const instance = resolveHALReceiver(innerReceiver);
    if (instance) {
      const argIRs = expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
      const result = processHALMethodBody(instance, method, argIRs);
      if (result) {
        if (result.emitLines.length > 0) {
          // Prepend inner emits so they appear before outer emits
          emitLines.unshift(...result.emitLines);
        }
        if (result.halOps.length > 0) {
          halOps.unshift(...result.halOps);
        }
      }
    }
    // Continue recursion to collect deeper chain levels
    if (ts.isCallExpression(innerReceiver) && ts.isPropertyAccessExpression(innerReceiver.expression)) {
      collectChainedHALEmits(innerReceiver, sourceText, diagnostics, pointerVars, emitLines, halOps);
    }
  }
}

/** Convert emit lines to a StatementIR (single emit or block of emits). */
export function emitLinesToIR(
  lines: string[],
  node: ts.Node,
  fileName: string,
  sourceText: string,
): StatementIR | null {
  if (lines.length === 0) return null;
  const emitStmts: StatementIR[] = lines.map(line => ({
    kind: "call" as const,
    sourceSpan: makeSourceSpan(node, fileName, sourceText),
    callee: "__EMIT__",
    args: [{ kind: "string" as const, value: line }],
  }));
  return emitStmts.length === 1
    ? emitStmts[0]
    : { kind: "block" as const, body: emitStmts, sourceSpan: makeSourceSpan(node, fileName, sourceText) };
}

/** Convert HALOpIR array to hal-op StatementIR nodes. */
export function halOpsToIR(
  ops: HALOpIR[],
  node: ts.Node,
  fileName: string,
  sourceText: string,
): StatementIR | null {
  if (ops.length === 0) return null;
  const span = makeSourceSpan(node, fileName, sourceText);
  const halStmts: StatementIR[] = ops.map(op => ({
    kind: "hal-op" as const,
    sourceSpan: span,
    operation: op,
    returns_value: false,
  }));
  return halStmts.length === 1
    ? halStmts[0]
    : { kind: "block" as const, body: halStmts, sourceSpan: span };
}
