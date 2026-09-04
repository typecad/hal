import { ExpressionIR, HALOpIR, StatementIR } from "../api/index.js";

/**
 * Shared utility for collecting identifiers from IR nodes.
 * This consolidates duplicate logic that was previously in:
 * - transpile.ts (collectExpressionIdentifiers, collectStatementIdentifiers)
 * - call-graph.ts (collectExpressionIdentifiers, collectStatementIdentifiers)
 * - build-ir.ts (similar traversal logic)
 */

/**
 * Collect all identifiers from an expression IR node.
 * Returns a Set of identifier names found.
 */
export function collectExpressionIdentifiers(expr: ExpressionIR | null | undefined): Set<string> {
  const identifiers = new Set<string>();

  // Safety check
  if (!expr || typeof expr !== "object" || !expr.kind) {
    return identifiers;
  }

  switch (expr.kind) {
    case "identifier":
      identifiers.add(expr.value);
      break;

    case "raw": {
      // Extract identifiers from raw expressions
      const matches = expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
      if (matches) {
        for (const match of matches) {
          identifiers.add(match);
        }
      }
      break;
    }

    case "await":
      for (const id of collectExpressionIdentifiers(expr.value)) {
        identifiers.add(id);
      }
      break;

    case "ternary":
      for (const id of collectExpressionIdentifiers(expr.condition)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(expr.whenTrue)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(expr.whenFalse)) {
        identifiers.add(id);
      }
      break;

    case "array":
      for (const element of expr.elements) {
        for (const id of collectExpressionIdentifiers(element)) {
          identifiers.add(id);
        }
      }
      break;

    case "object":
      for (const field of expr.fields) {
        for (const id of collectExpressionIdentifiers(field.value)) {
          identifiers.add(id);
        }
      }
      break;

    case "instanceof":
      for (const id of collectExpressionIdentifiers(expr.object)) {
        identifiers.add(id);
      }
      identifiers.add(expr.className);
      break;

    case "spread_array":
      for (const id of collectExpressionIdentifiers(expr.spreadExpr)) {
        identifiers.add(id);
      }
      for (const element of expr.additionalElements) {
        for (const id of collectExpressionIdentifiers(element)) {
          identifiers.add(id);
        }
      }
      break;

    case "binary":
      for (const id of collectExpressionIdentifiers(expr.left)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(expr.right)) {
        identifiers.add(id);
      }
      break;

    case "unary":
      for (const id of collectExpressionIdentifiers(expr.operand)) {
        identifiers.add(id);
      }
      break;

    case "property-access":
      for (const id of collectExpressionIdentifiers(expr.object)) {
        identifiers.add(id);
      }
      break;

    case "element-access":
      for (const id of collectExpressionIdentifiers(expr.object)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(expr.index)) {
        identifiers.add(id);
      }
      break;

    case "template_string":
      for (const id of collectExpressionIdentifiers(expr.expression)) {
        identifiers.add(id);
      }
      break;

    case "string_concat":
      for (const part of expr.parts) {
        for (const id of collectExpressionIdentifiers(part)) {
          identifiers.add(id);
        }
      }
      break;

    case "callback":
      // Callbacks have nested statements
      for (const stmt of expr.statements) {
        for (const id of collectStatementIdentifiers(stmt)) {
          identifiers.add(id);
        }
      }
      break;

    case "method-call": {
      const calleeParts = expr.callee.split(/->|::|\./);
      for (const part of calleeParts) {
        if (part.length > 0) {
          identifiers.add(part);
        }
      }
      for (const arg of expr.args) {
        for (const id of collectExpressionIdentifiers(arg)) {
          identifiers.add(id);
        }
      }
      break;
    }

    // Parenthesized expression — recurse into the inner expression. The `paren`
    // IR node exists to preserve explicit TS grouping (e.g. `(a + b) * c`), and
    // any free-function call nested inside parens (such as `!fn(x)` inside an
    // `(cond && !fn(x))` clause) MUST be visible to the call-graph/reachability
    // pass, or the function is tree-shaken and g++ reports "not declared in
    // this scope". Demo #22 Finding B — the root cause was the absence of this
    // case, not a forward-declaration or return-type gap.
    case "paren":
      for (const id of collectExpressionIdentifiers(expr.inner)) {
        identifiers.add(id);
      }
      break;

    // Tuple element access `std::get<N>(object)` — the object may reference a
    // reachable symbol.
    case "tuple-access":
      for (const id of collectExpressionIdentifiers(expr.object)) {
        identifiers.add(id);
      }
      break;

    // Arrow/lambda expression used as a value — walk its body for captured
    // identifiers (the call graph must see free functions/vars a lambda uses).
    case "lambda":
      for (const param of expr.params) {
        identifiers.add(param.name);
      }
      for (const stmt of expr.body) {
        for (const id of collectStatementIdentifiers(stmt)) {
          identifiers.add(id);
        }
      }
      break;

    // HAL operation used as an expression — delegate to the HAL identifier
    // collector (same logic as the hal-op statement case).
    case "hal-expr":
      for (const id of collectHALOpIdentifiers(expr.operation)) {
        identifiers.add(id);
      }
      break;

    // number, string, boolean have no identifiers
  }

  return identifiers;
}

/**
 * Collect all identifiers from a statement IR node.
 * Returns a Set of identifier names found.
 */
export function collectStatementIdentifiers(statement: StatementIR | null | undefined): Set<string> {
  const identifiers = new Set<string>();

  // Safety check
  if (!statement || typeof statement !== "object" || !statement.kind) {
    return identifiers;
  }

  switch (statement.kind) {
    case "call":
      // Extract function/method name from callee
      const calleeParts = statement.callee.split(/->|::|[.(]/);
      identifiers.add(calleeParts[0]);
      // Add EVERY callee part, not just the first. A `call` statement's callee
      // can be a lowered raw wrapper (`__RAW_STMT__out.push_back(glyphFor(op))`,
      // produced by ir/transformers/call-statement.ts when an outer call wraps
      // an inner free-function call). Only adding `calleeParts[0]` left the
      // inner callee (`glyphFor`) invisible to the call graph, so a free
      // function called only as a nested argument was tree-shaken and g++
      // reported it "not declared in this scope". Demo #28 Finding C.
      for (const part of calleeParts) {
        if (part.length > 0) {
          identifiers.add(part);
        }
      }
      // Also add the full callee (e.g. "Serial.begin") for polyfill detection
      identifiers.add(statement.callee);
      // Demo #31 Finding A — a `__RAW_STMT__` callee carries a fully-formed
      // C++ expression in its raw text (e.g. `parts.push_back(ONES_TEENS[i])`
      // or `__tc_pop(map[k])`), and the split on `/->|::|[.(]/` does NOT fully
      // tokenize it: it stops splitting once it hits `]` or `)`, so an indexed
      // identifier like `ONES_TEENS` survives glued to its suffix
      // (`"ONES_TEENS[i])"`) and is never added. The result: a top-level
      // variable referenced ONLY through `arr.push(globalArr[i])` from a class
      // method is tree-shaken, then g++ reports it "not declared in this
      // scope" from the inline method body. Same blind-spot family as demo
      // #22 B / demo #28 C, but in a DIFFERENT shape: those missed a free
      // FUNCTION buried in raw/paren text; this misses a free VARIABLE buried
      // in raw text behind an index. Fix: when the callee is a raw wrapper,
      // scan its raw text with the SAME identifier regex the `raw` expression
      // case uses (`case "raw"` above), so EVERY identifier in the embedded
      // expression is collected regardless of bracket/paren structure.
      if (statement.callee.startsWith("__RAW_STMT__")) {
        const matches = statement.callee.match(/[A-Za-z_][A-Za-z0-9_]*/g);
        if (matches) {
          for (const match of matches) {
            identifiers.add(match);
          }
        }
      }
      for (const arg of statement.args) {
        // Special case: if this is an __EMIT__ call, scan string literals for identifiers
        if (statement.callee === "__EMIT__" && arg.kind === "string") {
          const matches = arg.value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
          if (matches) {
            for (const match of matches) {
              identifiers.add(match);
            }
          }
        }
        for (const id of collectExpressionIdentifiers(arg)) {
          identifiers.add(id);
        }
      }
      break;

    case "var_decl":
      identifiers.add(statement.name);
      if (statement.initializer) {
        for (const id of collectExpressionIdentifiers(statement.initializer)) {
          identifiers.add(id);
        }
      }
      break;

    case "assign": {
      identifiers.add(statement.target);
      // An element-access target (`buf[i] = x`) references the base array;
      // extract it so the buffer's var_decl survives tree-shaking (the raw
      // `buf[i]` string never matches a declaration named `buf`).
      addElementAccessBase(statement.target, identifiers);
      for (const id of collectExpressionIdentifiers(statement.value)) {
        identifiers.add(id);
      }
      break;
    }

    case "update":
      identifiers.add(statement.target);
      addElementAccessBase(statement.target, identifiers);
      break;

    case "return":
      if (statement.value) {
        for (const id of collectExpressionIdentifiers(statement.value)) {
          identifiers.add(id);
        }
      }
      break;

    case "while":
    case "do_while":
      for (const id of collectExpressionIdentifiers(statement.condition)) {
        identifiers.add(id);
      }
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "if":
      for (const id of collectExpressionIdentifiers(statement.condition)) {
        identifiers.add(id);
      }
      for (const nested of statement.thenBranch) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      for (const nested of statement.elseBranch ?? []) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "for":
      if (statement.initializer) {
        for (const id of collectStatementIdentifiers(statement.initializer)) {
          identifiers.add(id);
        }
      }
      if (statement.condition) {
        for (const id of collectExpressionIdentifiers(statement.condition)) {
          identifiers.add(id);
        }
      }
      if (statement.increment) {
        for (const id of collectStatementIdentifiers(statement.increment)) {
          identifiers.add(id);
        }
      }
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "for_of":
      for (const id of collectStatementIdentifiers(statement.variable)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(statement.iterable)) {
        identifiers.add(id);
      }
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "for_in":
      for (const id of collectStatementIdentifiers(statement.variable)) {
        identifiers.add(id);
      }
      for (const id of collectExpressionIdentifiers(statement.object)) {
        identifiers.add(id);
      }
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "switch":
      for (const id of collectExpressionIdentifiers(statement.expression)) {
        identifiers.add(id);
      }
      for (const caseClause of statement.cases) {
        if (caseClause.value) {
          for (const id of collectExpressionIdentifiers(caseClause.value)) {
            identifiers.add(id);
          }
        }
        for (const nested of caseClause.body) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
      }
      break;

    case "try":
      if (statement.catchParam) {
        identifiers.add(statement.catchParam);
      }
      for (const nested of statement.tryBlock) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      for (const nested of statement.catchBlock ?? []) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      if (statement.finallyBlock) {
        for (const nested of statement.finallyBlock) {
          for (const id of collectStatementIdentifiers(nested)) {
            identifiers.add(id);
          }
        }
      }
      break;

    case "throw":
      for (const id of collectExpressionIdentifiers(statement.value)) {
        identifiers.add(id);
      }
      break;

    case "labeled":
      identifiers.add(statement.label);
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    case "block":
      for (const nested of statement.body) {
        for (const id of collectStatementIdentifiers(nested)) {
          identifiers.add(id);
        }
      }
      break;

    // break, continue have no identifiers

    case "hal-op":
      for (const id of collectHALOpIdentifiers(statement.operation)) {
        identifiers.add(id);
      }
      break;

    // break, continue have no identifiers
  }

  return identifiers;
}

/**
 * Extract identifier names from a HAL operation's string fields.
 * This ensures the call graph tracks function references embedded in
 * semantic HAL ops (e.g. the handler name in interrupt.attach_flags).
 */
/** Record the base identifier of an element-access lvalue (`buf[i]` → `buf`). */
function addElementAccessBase(target: string, identifiers: Set<string>): void {
  const base = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(target);
  if (base) identifiers.add(base[1]);
}

function collectHALOpIdentifiers(op: HALOpIR): Set<string> {
  const identifiers = new Set<string>();
  switch (op.operation) {
    case "interrupt.attach_flags":
      // handler is a resolved C++ function name (e.g. "myIsr" or a placeholder)
      identifiers.add(op.handler);
      break;
    case "mqtt.on_message":
      // handler is the user's onMessage callback name (callback() resolves it to
      // a string). Without this the tree-shaker drops the function declaration —
      // the mqtt.on_message op only carries the name, so the function has no
      // other reference and looks unreachable. Same shape as interrupt.attach_flags.
      identifiers.add(op.handler);
      break;
    case "wifi.on_event":
      identifiers.add(op.handler);
      break;
    case "ble.on_read":
    case "ble.on_write":
    case "ble.on_connect":
    case "ble.on_disconnect":
      identifiers.add(op.handler);
      break;
    case "raw": {
      // Raw C++ code may reference user-defined identifiers
      const matches = op.code.match(/[A-Za-z_][A-Za-z0-9_]*/g);
      if (matches) {
        for (const match of matches) {
          identifiers.add(match);
        }
      }
      break;
    }
    // Other HAL ops have only numeric/literal fields — no identifier references
  }
  // HAL ops can carry resolved C++ expression texts in their string fields —
  // not just wifi/http/mqtt (e.g. wifi.connect ssid: `WIFI_SSID`, a top-level
  // const) but also peripheral lowerings that inline a user buffer into the
  // emitted code (spi.transceive rx: `static_cast<const void*>(id)`). Scan
  // every string field of every op for identifiers so referenced variables
  // survive tree-shaking; quoted literals are skipped. Over-matching is safe
  // (the reachability set just keeps a name no var_decl uses).
  for (const value of Object.values(op)) {
    if (typeof value !== "string" || value === op.operation) continue;
    if (/^".*"$/.test(value.trim())) continue;
    const matches = value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (matches) {
      for (const match of matches) {
        identifiers.add(match);
      }
    }
  }
  return identifiers;
}

