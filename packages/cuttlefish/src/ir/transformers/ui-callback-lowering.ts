// ---------------------------------------------------------------------------
// Shared lowering for UI callback bodies (onToggle, watchPin).
//
// Author callbacks passed to screen.<elem>.onToggle(pin, cb) and
// ui.watchPin(pin, cb) are lowered to a C++ *string* at IR-build time (see
// call-statement.ts and ui-call-resolver.ts). The body is later emitted
// verbatim by ui-emitter.ts into a synthesized ISR function — it does NOT pass
// back through the statement-renderer, so anything the renderer normally does
// (console.* → Serial.println/cout, color-name resolution, signal lowering)
// must be done HERE.
//
// Previously each call site duplicated this logic and neither copy handled
// `console.*` calls, which leaked the literal text `console.log_(...)` into
// generated ISR functions and failed at g++ time with
// "'console' was not declared in this scope". This module is the single source
// of truth so the two call sites can't drift again.
// ---------------------------------------------------------------------------

import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { resolveColor } from "../../ui/color.js";
import { getContext } from "../build-ir-state.js";
import { getConsoleMethod } from "../../emit/utils/type-inference.js";
import { isSignalName } from "./ui-call-resolver.js";

// ── Console-in-callback tracking ──────────────────────────────────────────
//
// When a `console.*` call is lowered inside a UI callback (onToggle/watchPin),
// the resulting platform output (Serial.println / std::cout / ...) is baked
// into a callbackBody *string*, not an IR node. The program-analysis pass
// that drives auto-injected Serial.begin(9600) walks IR nodes, so it would
// miss these and fail to initialize the UART. This flag records that a
// console call was lowered into a callback so analyzeProgram can consult it.
// Reset together with the other UI module state each transpile run.

let _loweredConsoleInCallback = false;

/** True if any lowered UI callback (onToggle/watchPin) body contains a
 *  platform-transformed console call. */
export function loweredConsoleInCallback(): boolean {
  return _loweredConsoleInCallback;
}

/** Reset the console-in-callback flag. Called per transpile run. */
export function resetCallbackLoweringState(): void {
  _loweredConsoleInCallback = false;
}

/**
 * Lower a single callback-body expression to a C++ string (no trailing `;`).
 *
 * Handles, in priority order:
 *   1. console.<method>(args) → platform-transformed output
 *      (Serial.println / std::cout / ...), routed through the active
 *      platform strategy so it matches what the statement-renderer emits for
 *      top-level console calls.
 *   2. signal.set(value)  → signal = value   (write)
 *   3. signal()           → signal           (read)
 *   4. any other expression → lowered via expressionToIR, with CSS color
 *      string literals resolved to rgb565 hex (e.g. "limegreen" → 0x07e0).
 */
export function lowerCallbackExpr(
  expr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
): string {
  // 1. console.<method>(...args) → platform transform.
  // Without this the call falls through to expressionToIR, which renders the
  // callee verbatim and produces invalid C++ (`console.log_(...)`).
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === "console"
  ) {
    const method = expr.expression.name.text;
    const renderedArgs = expr.arguments
      .map((arg) => renderExprAsText(expressionToIR(arg, sourceText, diagnostics)))
      .join(" << ");
    // Record that a console call was lowered into a callback body so that
    // analyzeProgram can set hasConsoleCalls and the platform strategy can
    // inject Serial.begin() / iostream. Without this, the baked-in
    // Serial.println text in the synthesized ISR is invisible to the IR walk.
    _loweredConsoleInCallback = true;
    const strategy = getContext().activeStrategy;
    if (strategy) {
      // `forHeader=false` so the strategy appends its trailing `;` for a
      // statement-position call — matches statement-renderer behavior.
      return strategy.transformConsoleCall(method, renderedArgs, false).replace(/;$/, "");
    }
    // No strategy bound: fall back to a plain cout (matches generic-strategy
    // shape) so we still emit valid C++ rather than `console.log_(...)`.
    return `std::cout << ${renderedArgs} << std::endl`;
  }

  // 2. signal.set(value) → signal = value
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "set" &&
    ts.isIdentifier(expr.expression.expression) &&
    isSignalName(expr.expression.expression.text)
  ) {
    const sigName = expr.expression.expression.text;
    const argText = expr.arguments[0]
      ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics))
      : "0";
    return `${sigName} = ${argText}`;
  }

  // 3. signal() → signal (read)
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.arguments.length === 0 &&
    isSignalName(expr.expression.text)
  ) {
    return expr.expression.text;
  }

  // 4. Generic expression: lower via expressionToIR, then resolve color names.
  let raw = renderExprAsText(expressionToIR(expr, sourceText, diagnostics));
  raw = raw.replace(
    /"(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+|rgba?\([^)]*\))"/g,
    (match: string, color: string) => {
      try {
        return `0x${resolveColor(color, "rgb565").toString(16)}`;
      } catch {
        return match;
      }
    },
  );
  return raw;
}

/**
 * Lower an arrow/function-expression callback's body to a single C++ string
 * of space-joined statements (each already terminated with `;`).
 *
 * Accepts either a block body (`() => { ... }`) or an expression body
 * (`() => expr`). Non-expression statements inside a block (e.g. `let`, `if`)
 * are skipped — UI callbacks are expected to be signal/color/io side-effects.
 */
export function lowerCallbackBody(
  cbArg: ts.ArrowFunction | ts.FunctionExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
): string {
  const body = cbArg.body;

  if (ts.isExpression(body)) {
    return lowerCallbackExpr(body, sourceText, diagnostics) + ";";
  }

  if (ts.isBlock(body)) {
    const parts: string[] = [];
    for (const stmt of body.statements) {
      if (ts.isExpressionStatement(stmt) && stmt.expression) {
        parts.push(lowerCallbackExpr(stmt.expression, sourceText, diagnostics) + ";");
      }
    }
    return parts.join(" ");
  }

  return "";
}
