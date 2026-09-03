import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, ExpressionIR, CppType } from "../../api/index.js";
import { makeSourceSpan, extractNodeComments, makeDiagnostic } from "../ast-node-utils.js";
import { PointerTracker, arrayLiteralSizes } from "../build-ir-state.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { CppTypeHint, inferExprCppType } from "../type-resolution.js";
import { tryLowerRegisterWrite } from "./register-assignment.js";
import { 
  assignmentOperatorToString, 
  updateLocalTypeFromAssignment, 
  callToStatement 
} from "../statement-to-ir.js";

export { expressionToIR } from "../expression-to-ir.js";

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

  // `void expr();` — the fire-and-forget idiom. Lower the inner call like a
  // bare call statement (the raw (void)(...) form drops it entirely, which
  // silently skipped the async-method kickoff: `void b.run();`). Free async
  // function calls reaching here are still filtered at top level (their
  // tasks auto-start), so the idiom keeps its meaning there.
  if (ts.isVoidExpression(expr) && ts.isCallExpression(expr.expression)) {
    return callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
  }

  if (ts.isAwaitExpression(expr) && ts.isCallExpression(expr.expression)) {
    const callStmt = callToStatement(statement, expr.expression, fileName, sourceText, diagnostics, pointerVars);
    if (callStmt && callStmt.kind === "call") {
      return { ...callStmt, isAwaited: true };
    }
    // Awaited network HAL ops (WiFi.connect / WiFi.untilConnected / Http.send
    // / ...) resolve to hal-op statements, which would otherwise lower to the
    // BLOCKING shim call even inside an async state machine. Rewrite them to
    // an awaited __WIFI_WAIT__/__HTTP_WAIT__ marker call carrying the original
    // op; the async state-machine generator turns it into a start + poll state
    // pair, and the statement renderer falls back to the blocking form when
    // the marker is rendered outside a state machine (top-level await, awaits
    // nested in unsupported positions).
    const netMarker = awaitedNetMarker(callStmt);
    if (netMarker) return netMarker;
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

  // Destructuring assignment: `[a, b] = expr` (reassignment to existing
  // variables, NOT a const/let declaration). Without this, `[a, b] = [b, a]`
  // fell through to `return undefined` and was silently dropped. Lower to
  // individual assignments, evaluating the RHS array elements to temporaries
  // FIRST so a swap is correct (old values captured before any assignment).
  if (ts.isBinaryExpression(expr)
      && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isArrayLiteralExpression(expr.left)) {
    const targets = expr.left.elements.filter(ts.isIdentifier);
    const rhs = expr.right;
    const stmts: StatementIR[] = [];
    const span = makeSourceSpan(statement, fileName, sourceText);
    const comments = extractNodeComments(statement, sourceText);
    if (ts.isArrayLiteralExpression(rhs)) {
      // `[a, b] = [b, a]` → temp_0 = b; temp_1 = a; a = temp_0; b = temp_1;
      const temps: string[] = [];
      for (let i = 0; i < targets.length; i++) {
        const tempName = `__swap_${i}`;
        temps.push(tempName);
        stmts.push({
          kind: "var_decl",
          sourceSpan: span,
          name: tempName,
          storage: "const",
          cppType: "auto",
          initializer: expressionToIR(rhs.elements[i], sourceText, diagnostics, pointerVars),
        });
      }
      for (let i = 0; i < targets.length; i++) {
        stmts.push({
          kind: "assign",
          sourceSpan: span,
          target: targets[i].text,
          operator: "=",
          value: { kind: "identifier", value: temps[i] },
        });
      }
    } else {
      // `[a, b] = arr` → a = arr[0]; b = arr[1]; (index-based)
      const rhsText = renderExprAsText(expressionToIR(rhs, sourceText, diagnostics, pointerVars));
      for (let i = 0; i < targets.length; i++) {
        stmts.push({
          kind: "assign",
          sourceSpan: span,
          target: targets[i].text,
          operator: "=",
          value: { kind: "element-access", object: { kind: "identifier", value: rhsText }, index: { kind: "number", value: i } },
        });
      }
    }
    if (stmts.length > 0) {
      return {
        kind: "block",
        sourceSpan: span,
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        body: stmts,
      };
    }
  }

  return undefined;
}

/** HAL ops with a start/poll split available in the async state machine
 *  (see async-state-machine.ts netWaitInfo — keep the two in sync).
 *  timing.delay is included because `delay()` from @typecad/hal resolves to a
 *  hal-op, dropping the isAwaited flag the state machine keys on. */
const AWAITABLE_HAL_OPS = new Set<string>([
  "timing.sleep",
  "wifi.join",
  "wifi.scan",
  "http.send",
]);

/**
 * Rewrite an awaited hal-op statement (or a block whose LAST statement is
 * one — chained HAL calls resolve to blocks of hal-ops) into an awaited
 * `__WIFI_WAIT__` / `__HTTP_WAIT__` / `__HAL_WAIT__` marker call carrying the
 * original op as a hal-expr argument. Returns undefined when the statement is
 * not an awaitable HAL op.
 */
function awaitedNetMarker(stmt: StatementIR | undefined): StatementIR | undefined {
  if (!stmt) return undefined;
  if (stmt.kind === "hal-op" && AWAITABLE_HAL_OPS.has(stmt.operation.operation)) {
    const opName = stmt.operation.operation;
    const callee = opName.startsWith("http.") ? "__HTTP_WAIT__"
      : opName.startsWith("wifi.") ? "__WIFI_WAIT__"
      : opName.startsWith("ble.") ? "__BLE_WAIT__"
      : "__HAL_WAIT__";
    return {
      kind: "call",
      sourceSpan: stmt.sourceSpan,
      leadingComments: stmt.leadingComments,
      trailingComments: stmt.trailingComments,
      callee,
      args: [{ kind: "hal-expr", operation: stmt.operation }],
      isAwaited: true,
    };
  }
  if (stmt.kind === "block" && stmt.body.length > 0) {
    const last = awaitedNetMarker(stmt.body[stmt.body.length - 1]);
    if (last) {
      return { ...stmt, body: [...stmt.body.slice(0, -1), last] };
    }
  }
  return undefined;
}
