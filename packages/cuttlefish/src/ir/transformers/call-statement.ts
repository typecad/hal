import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR } from "../../api/index.js";
import { PointerTracker, requiredIncludes, mutableArrayVars, nestedClassAliases, hoistedNestedClasses, topLevelClassNames, topLevelClasses, activeEnumNames, hoistedNestedFunctions } from "../build-ir-state.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { extractNodeComments, makeSourceSpan } from "../ast-node-utils.js";
import { tryResolveHALMethod } from "./hal-call-resolver.js";
import { tryResolveUICall, isSignalName, resolveUIModuleImport, recordPressBinding, uiPressBindings, resolveNodeIndex } from "./ui-call-resolver.js";
import { tryLowerArrayAndStringMethods } from "./array-methods.js";
import { expressionToIR } from "../expression-to-ir.js";
import { lowerStatementList } from "../statement-to-ir.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import { renderExprAsText, calleeToText } from "../render-expr.js";
import { parseCppType, renderCppType, parsedIsPointer, parsedIsMap, parsedIsSet } from "../../api/shared/cpp-type-ir.js";

/**
 * When a Map/Set key is an enum-typed expression and the container's key type
 * is an integral type, the lowered `map[key]` / `map.count(key)` / `map.at(key)`
 * would pass the enum operand directly. A C++ `enum class` does not implicitly
 * convert to the map's integral key type, so g++ rejects it ("no match for
 * 'operator[]' ... 'K' to 'const int&'"). Wrap the key in
 * `static_cast<KeyType>(...)` so it matches.
 *
 * This handles BOTH shapes of enum-typed key operand:
 *   - an enum member access (`Color.Red`, `Op.Inc`) — detected via
 *     `activeEnumNames` on the object identifier; and
 *   - a bare identifier whose declared type is an enum (`k` where `k: K`) —
 *     resolved through the in-scope IR type map (the gap demo #28 Finding E
 *     surfaced: previously only enum-member access was cast, so a bare
 *     enum-typed key variable on `.set`/`.has`/`.get`/`.delete` compiled to an
 *     uncast `map[k]`/`map.count(k)`/`map.at(k)` and failed at g++ time).
 */
function castEnumKeyIfNeeded(
  keyText: string,
  keyNode: ts.Expression,
  receiverType: string,
): string {
  // Only relevant for std::map/std::set with an integral key type.
  if (!parsedIsMap(receiverType) && !parsedIsSet(receiverType)) return keyText;
  const containerIr = parseCppType(receiverType);
  const keyType = containerIr.kind === "map" ? renderCppType(containerIr.key) : "";
  const isIntegral = /^(int|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|size_t|long|short|unsigned|char)$/.test(keyType);
  if (!isIntegral) return keyText;
  // Detect an enum-typed key operand.
  let isEnum = false;
  if (ts.isPropertyAccessExpression(keyNode) && ts.isIdentifier(keyNode.expression)) {
    // Enum member access: `Color.Red`.
    isEnum = activeEnumNames.has(keyNode.expression.text);
  } else if (ts.isIdentifier(keyNode)) {
    // Bare identifier: resolve its declared type through the IR type scope.
    // If it is an enum name, the operand is enum-typed and needs the cast.
    const varType = getCurrentIrTypeScope()?.locals.get(keyNode.text) ?? getCurrentIrTypeScope()?.globals.get(keyNode.text);
    if (varType && activeEnumNames.has(varType)) {
      isEnum = true;
    }
  }
  if (!isEnum) return keyText;
  return `static_cast<${keyType}>(${keyText})`;
}

export function callToStatement(
  statementNode: ts.ExpressionStatement,
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker = new Map(),
): StatementIR {
  const comments = extractNodeComments(statementNode, sourceText);

  // ── setInterval/setTimeout arrow-callback hoisting (BEFORE HAL) ────────
  // The timer helpers are runtime utilities, never HAL methods, but the HAL
  // resolver treats bare-identifier globals as pseudo-HAL calls and claims
  // them — baking the arrow arg into a lambda placeholder before our hoist
  // can run. Intercept timer calls with arrow callbacks FIRST, hoist the
  // arrow to a named function, and short-circuit before HAL sees it.
  if (ts.isIdentifier(call.expression) && TIMER_CALLEES.has(call.expression.text)) {
    const hoisted = hoistTimerArrowArg(call, fileName, sourceText, diagnostics, pointerVars, comments);
    if (hoisted) return hoisted;
  }

  // ── signal.set(value) → assignment ─────────────────────────────────────
  // A signal lowers to a plain device variable; its .set() method is just an
  // assignment. Intercept before HAL so it doesn't try to resolve .set as a
  // HAL method on the variable.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "set" &&
    ts.isIdentifier(call.expression.expression) &&
    isSignalName(call.expression.expression.text)
  ) {
    const valueIR = call.arguments[0] ? expressionToIR(call.arguments[0], sourceText, diagnostics, pointerVars) : { kind: "number" as const, value: 0 };
    return {
      kind: "assign",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      target: call.expression.expression.text,
      operator: "=",
      value: valueIR,
    };
  }

  // ── screen.btn.onPress(pin) / onRelease(pin) ───────────────────────────
  // Lowers to a press-binding record: the emit layer emits a handler function
  // (ui_on_press(nodeIndex)) and an attachInterrupt in setup(). The call shape
  // is <tree>.<id>.onPress(<pin>) — a chained property access on an imported
  // UI tree element.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    (call.expression.name.text === "onPress" || call.expression.name.text === "onRelease") &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    ts.isIdentifier(call.expression.expression.expression)
  ) {
    const treeName = call.expression.expression.expression.text;
    const elemId = call.expression.expression.name.text;
    const edge = call.expression.name.text === "onPress" ? "press" : "release";
    const pinArg = call.arguments[0];
    const pinText = pinArg ? (ts.isIdentifier(pinArg) ? pinArg.text : String(pinArg.getText())) : "0";

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId) : 0;
    const handlerName = `__ui_${elemId}_${edge}_${uiPressBindings().length}`;
    recordPressBinding({ nodeIndex, pin: pinText, edge, handlerName });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ---- HAL method resolver (highest priority) ---
  const halResolved = tryResolveHALMethod(call, fileName, sourceText, diagnostics, pointerVars);
  if (halResolved) return halResolved;

  // ---- ui.mount / ui.signal / ui.bind — UI authoring calls ---
  // Handles statement-position ui.* calls. const X = ui.signal(...) (a
  // VariableDeclaration, not an ExpressionStatement) is handled in the
  // variable-declaration path; here we see bare ui.signal(...) statements
  // and synthesize a signal name.
  const uiResolved = tryResolveUICall(call, fileName, sourceText, diagnostics);
  if (uiResolved) return uiResolved;

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

  // ── Structural vector/array method lowering (shared with expressionToIR) ─
  // Lower .push/.pop/.map/.filter/.splice/... on a std::vector receiver to the
  // __tc_* helper form (or push_back) BEFORE the generic call handling below.
  // This mirrors expressionToIR's call to tryLowerArrayAndStringMethods, so the
  // statement form (`out.push(x);`) and the expression form (`x = arr.pop()`)
  // share one structural lowering. Previously only the StaticArray case was
  // handled here (mutableArrayVars branch below); the std::vector case was left
  // as a raw `out.push` callee and patched to `push_back` by a regex in the
  // native strategy's normalizeRawExpression. Demo #22 / Tier-2 cleanup.
  const lowered = tryLowerArrayAndStringMethods(call, sourceText, diagnostics, pointerVars);
  if (lowered) {
    if (lowered.kind === "method-call") {
      // Callback-arg methods (.map/.filter/.sort(fn)/...): preserve the
      // structured method-call node as a `call` statement so (a) the emit-time
      // callback hoister finds the callback in `args` and names it, and (b)
      // program-analysis detects the __tc_* helper usage from `callee`.
      return {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        callee: lowered.callee,
        args: lowered.args,
      };
    }
    // Value-arg methods (.push/.pop/.fill/.concat/...): the lowering produced a
    // fully-formed C++ expression (e.g. `out.push_back(x)` or `__tc_pop(arr)`);
    // emit it as a raw statement. The __tc_* helper usage is detected by
    // program-analysis via the `includes(name)` check on the call callee.
    const loweredText = renderExprAsText(lowered);
    return {
      kind: "call",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      callee: "__RAW_STMT__" + loweredText,
      args: [],
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
        receiverType = getCurrentIrTypeScope()?.locals.get(mapReceiver.text) ?? getCurrentIrTypeScope()?.globals.get(mapReceiver.text);
      } else if (ts.isPropertyAccessExpression(mapReceiver) && mapReceiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
        receiverType = getCurrentIrTypeScope()?.locals.get(`this->${mapReceiver.name.text}`);
      }

      if (receiverType && (parsedIsMap(receiverType) || parsedIsSet(receiverType))) {
        const recIR = expressionToIR(mapReceiver, sourceText, diagnostics, pointerVars);
        const recText = renderExprAsText(recIR);
        const arg0IR = expressionToIR(call.arguments[0], sourceText, diagnostics, pointerVars);
        const arg0Text = renderExprAsText(arg0IR);

        if (parsedIsMap(receiverType) && mapMethodName === "set" && call.arguments.length >= 2) {
          const arg1IR = expressionToIR(call.arguments[1], sourceText, diagnostics, pointerVars);
          const arg1Text = renderExprAsText(arg1IR);
          const castedKey = castEnumKeyIfNeeded(arg0Text, call.arguments[0], receiverType);
          return {
            kind: "assign" as const,
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            target: `${recText}[${castedKey}]`,
            operator: "=",
            value: { kind: "raw" as const, value: arg1Text },
          };
        }
        if (parsedIsMap(receiverType) && mapMethodName === "get") {
          const castedKey = castEnumKeyIfNeeded(arg0Text, call.arguments[0], receiverType);
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.at`,
            args: [{ kind: "raw" as const, value: castedKey }],
          };
        }
        if ((parsedIsMap(receiverType) || parsedIsSet(receiverType)) && mapMethodName === "has") {
          const castedKey = castEnumKeyIfNeeded(arg0Text, call.arguments[0], receiverType);
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.count`,
            args: [{ kind: "raw" as const, value: castedKey }],
          };
        }
        if ((parsedIsMap(receiverType) || parsedIsSet(receiverType)) && mapMethodName === "delete") {
          const castedKey = castEnumKeyIfNeeded(arg0Text, call.arguments[0], receiverType);
          return {
            kind: "call",
            sourceSpan: makeSourceSpan(call, fileName, sourceText),
            leadingComments: comments.leadingComments,
            trailingComments: comments.trailingComments,
            callee: `${recText}.erase`,
            args: [{ kind: "raw" as const, value: castedKey }],
          };
        }
        if (parsedIsSet(receiverType) && mapMethodName === "add") {
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
        if (method && parsedIsPointer(method.returnType as string)) {
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
          if (chainMethod && (parsedIsPointer(chainMethod.returnType as string) || (chainMethod.returnType as string) === innerReceiver.text)) {
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

  // Timer calls with arrow callbacks are intercepted before HAL (above);
  // named-function callbacks fall through here unchanged.
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: call.arguments.map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
  };
}

// ── setInterval/setTimeout arrow-callback hoisting ──────────────────────────

const TIMER_CALLEES = new Set(["setInterval", "setTimeout", "__tc_setInterval", "__tc_setTimeout"]);

let timerCallbackCounter = 0;

/**
 * Hoist an inline arrow/function-expression callback argument of a
 * setInterval/setTimeout call to a named free function, and return the
 * rewritten call with the function name replacing the arrow.
 *
 * Returns null if arg[0] isn't an inline arrow/function (named-function
 * callbacks pass through to the generic path unchanged).
 *
 * Called from the generic fallthrough at the end of callToStatement — NOT
 * as an early return — because top-level timer calls reach the fallthrough
 * path, not the early-interception points.
 */
function hoistTimerArrowArg(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
  comments: { leadingComments: string[]; trailingComments: string[] },
): StatementIR | null {
  const callbackArg = call.arguments[0];
  if (!callbackArg || !(ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg))) {
    return null;
  }

  const fnName = `__tc_timer_cb_${timerCallbackCounter++}`;
  const bodyStatements = lowerStatementList(
    ts.isBlock(callbackArg.body) ? callbackArg.body.statements : [],
    fileName,
    sourceText,
    diagnostics,
    new Map(),
    new Map(),
    fnName,
    undefined,
    new Map(),
  );

  if (!ts.isBlock(callbackArg.body)) {
    const exprText = renderExprAsText(expressionToIR(callbackArg.body, sourceText, diagnostics));
    bodyStatements.push({
      kind: "call",
      sourceSpan: makeSourceSpan(callbackArg.body, fileName, sourceText),
      callee: "__EMIT__",
      args: [{ kind: "string", value: exprText }],
    });
  }

  hoistedNestedFunctions.push({
    originalName: fnName,
    isAsync: false,
    returnType: "void",
    sourceSpan: makeSourceSpan(callbackArg, fileName, sourceText),
    leadingComments: [],
    trailingComments: [],
    parameters: [],
    statements: bodyStatements,
  });

  // Apply the polyfill helper rename (setInterval → __tc_setInterval) so the
  // emitted call matches the runtime helper the framework provides.
  const rawCallee = ts.isIdentifier(call.expression) ? call.expression.text : calleeToText(call.expression);
  const calleeText = rawCallee === "setInterval" ? "__tc_setInterval"
    : rawCallee === "setTimeout" ? "__tc_setTimeout"
    : rawCallee;
  const remainingArgs = call.arguments.slice(1).map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars));
  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: [{ kind: "identifier", value: fnName }, ...remainingArgs],
  };
}
