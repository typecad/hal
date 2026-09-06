import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR } from "../../api/index.js";
import { PointerTracker, requiredIncludes, mutableArrayVars, nestedClassAliases, hoistedNestedClasses, topLevelClassNames, topLevelClasses, activeEnumNames, hoistedNestedFunctions, getContext } from "../build-ir-state.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { type CppTypeHint } from "../type-resolution.js";
import { extractNodeComments, makeSourceSpan, makeDiagnostic } from "../ast-node-utils.js";
import { tryResolveHALMethod } from "./hal-call-resolver.js";
import { tryResolveUICall, isSignalName, resolveUIModuleImport, recordPressBinding, uiPressBindings, resolveNodeIndex, resolveNodeTag, watchPinSpecs, recordWatchPin, recordClickHandler, clickHandlers, pushUnknownElementDiagnostic } from "./ui-call-resolver.js";
import { hasSafetyHook, requireSafetyHook } from "../../safety-hook.js";
import {
  lowerCallbackStatements,
  resolveCallbackArg,
  getCanvasAmbientCtx,
  getCanvasAmbientDiagnostics,
  getCanvasAmbientSourceText,
} from "./ui-callback-lowering.js";
import { rewriteCanvasCall } from "./canvas-lowering.js";
import { callbackContextLabel, unsupportedStatementHint } from "./callback-context-registry.js";
import { tryLowerArrayAndStringMethods } from "./array-methods.js";
import { expressionToIR } from "../expression-to-ir.js";
import { lowerStatementList } from "../statement-to-ir.js";
import { escapeCppKeyword } from "../../utils/strings.js";
import { renderExprAsText, calleeToText } from "../render-expr.js";
import { parseCppType, renderCppType, parsedIsPointer, parsedIsMap, parsedIsSet } from "../../api/shared/cpp-type-ir.js";

/**
 * Resolve a `screen.<id>` or `screen.groups.<screenId>.<id>` element receiver
 * (the object a method like .onClick is called on) into its tree name, element
 * handle, and optional screen-id scope. Returns undefined when the expression
 * is neither shape. The screenId is present only for the grouped form; callers
 * pass it to resolveNodeIndex/resolveNodeTag to scope the search.
 */
function resolveElementReceiver(expr: ts.Expression): { treeName: string; elemId: string; screenId?: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  // Flat: screen.<id>  →  expr.expression is an Identifier ("screen").
  if (ts.isIdentifier(expr.expression)) {
    return { treeName: expr.expression.text, elemId: expr.name.text };
  }
  // Grouped: screen.groups.<screenId>.<id>  →  expr.expression is
  //   PropertyAccess(screen.groups, screenId), i.e. two levels deeper.
  const inner = expr.expression;  // screen.groups.<screenId>
  if (
    ts.isPropertyAccessExpression(inner) &&
    ts.isPropertyAccessExpression(inner.expression) &&
    ts.isIdentifier(inner.expression.expression) &&
    inner.expression.expression.text === "screen" &&
    inner.expression.name.text === "groups"
  ) {
    return { treeName: "screen", elemId: expr.name.text, screenId: inner.name.text };
  }
  return undefined;
}

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

/** Lower a void UI event callback (onClick/onHold/onRelease/arity-1 onChange)
 *  to bodyStatements + optional named-ref metadata. */
function lowerVoidEventCallback(
  cbArg: ts.Expression | undefined,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  label: string,
): {
  bodyStatements?: StatementIR[];
  isNamedRef?: boolean;
  namedFn?: string;
  sourceSpan?: ReturnType<typeof makeSourceSpan>;
} {
  const resolved = resolveCallbackArg(cbArg, cbArg?.getSourceFile(), diagnostics, label);
  if (!resolved) return {};
  const sourceSpan = cbArg ? makeSourceSpan(cbArg, fileName, sourceText) : undefined;
  if (resolved.kind === "inline") {
    return {
      bodyStatements: lowerCallbackStatements(resolved.fn, fileName, sourceText, diagnostics, "ui-event-callback"),
      sourceSpan,
    };
  }
  return { isNamedRef: true, namedFn: resolved.name, sourceSpan };
}

/** Lower an optional callback for watchPin-style wrappers that have a prelude
 *  (onToggle / onChange(pin,count)). Named refs become a call after prelude. */
function lowerPreludeCallback(
  cbArg: ts.Expression | undefined,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
  label: string,
  prelude: StatementIR[],
): { bodyStatements: StatementIR[]; sourceSpan?: ReturnType<typeof makeSourceSpan> } {
  const resolved = resolveCallbackArg(cbArg, cbArg?.getSourceFile(), diagnostics, label);
  const sourceSpan = cbArg ? makeSourceSpan(cbArg, fileName, sourceText) : undefined;
  if (!resolved) return { bodyStatements: prelude, sourceSpan };
  if (resolved.kind === "inline") {
    return {
      bodyStatements: [
        ...prelude,
        ...lowerCallbackStatements(resolved.fn, fileName, sourceText, diagnostics, "ui-event-callback"),
      ],
      sourceSpan,
    };
  }
  return {
    bodyStatements: [
      ...prelude,
      {
        kind: "call",
        sourceSpan: sourceSpan ?? makeSourceSpan(cbArg!, fileName, sourceText),
        callee: resolved.name,
        args: [],
      },
    ],
    sourceSpan,
  };
}

/** Detect `safe.<method>(...)` calls in statement position and lower them to
 *  a hal-op statement via the safety hook's resolveSemanticCall. Mirrors the
 *  UI call resolver pattern. Returns null when:
 *  - the safety engine is not loaded (hasSafetyHook() === false), or
 *  - the call is not a `safe.<method>(...)` shape, or
 *  - the hook declines to lower it (returns undefined).
 *
 *  Expression-position safe.* calls (e.g. `const r = safe.read(pin)`) are
 *  handled separately in the variable-declaration transformer. */
function tryResolveSafetyCallStatement(
  call: ts.CallExpression,
  fileName: string,
  sourceText: string,
): StatementIR | null {
  if (!hasSafetyHook()) return null;
  // Shape: safe.<method>(args...) — PropertyAccessExpression on identifier "safe".
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  if (!ts.isIdentifier(call.expression.expression)) return null;
  if (call.expression.expression.text !== "safe") return null;

  const method = call.expression.name.text;
  // Extract simple literal/identifier arg values; non-literal args are passed
  // as their rendered text so the hook can decide. The hook consumes
  // safe.read (pin), safe.write (pin, value), and safe.pinMode (pin, mode).
  // For safe.write, the value may be a property access (r.value), arithmetic
  // expression, or variable — rendered to its C++ text form.
  const argValues: unknown[] = call.arguments.map((a) => {
    if (ts.isNumericLiteral(a)) return Number(a.text);
    if (ts.isStringLiteral(a)) return a.text;
    if (a.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (a.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(a)) {
      return a.text;
    }
    // Property access (e.g. r.value), arithmetic, or other expression:
    // render to the C++ expression text so the op can emit it inline.
    return a.getText();
  });

  const op = requireSafetyHook().resolveSemanticCall?.(`safe.${method}`, argValues);
  if (!op) return null;

  return {
    kind: "hal-op",
    operation: op,
    returns_value: false,
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
  } as StatementIR;
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

  // ── console.* is not a supported API ────────────────────────────────────
  // The TypeScript console carry-over (lowering to a platform print plus a
  // config section routing it) is gone. Programs write to a serial console
  // explicitly: USB0.writeLine(...) or UART0.writeLine(...). Sourced at IR
  // build time so the diagnostic points at the user's statement and the
  // real pipeline aborts before emit.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "console"
  ) {
    diagnostics.push(makeDiagnostic(
      sourceText,
      call.getStart(),
      `console.${call.expression.name.text}() is not supported — write to a serial console instead: \`USB0.writeLine(...)\` (USB CDC) or \`UART0.writeLine(...)\` from the board module.`,
      "error",
      "console-unsupported",
    ));
    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── Ambient canvas ctx: rewrite ctx.method(...) while drawCanvas lowers ──
  {
    const canvasCtx = getCanvasAmbientCtx();
    if (canvasCtx) {
      const ambientDiags = getCanvasAmbientDiagnostics() ?? diagnostics;
      const ambientSrc = getCanvasAmbientSourceText() ?? sourceText;
      if (
        ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === canvasCtx
      ) {
        const rewritten = rewriteCanvasCall(call, canvasCtx, ambientDiags, ambientSrc);
        return {
          kind: "call",
          sourceSpan: makeSourceSpan(call, fileName, sourceText),
          leadingComments: comments.leadingComments,
          trailingComments: comments.trailingComments,
          callee: "__EMIT__",
          args: [{ kind: "string", value: (rewritten ?? "").replace(/;$/, "") }],
        };
      }
      ambientDiags.push({
        severity: "error",
        code: "ui-callback-unsupported-statement",
        message: `Unsupported statement in ${callbackContextLabel("ui-draw-canvas")}: only ctx.* drawing calls are allowed here.`,
        hint: unsupportedStatementHint("ui-draw-canvas"),
        source: ambientSrc.slice(Math.max(0, call.getStart() - 40), call.getEnd() + 10).trim(),
      } as Diagnostic);
      return {
        kind: "block",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        body: [],
      };
    }
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
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }
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

  // ── screen.led.onToggle(pin, callback) — checkbox toggle ──────────────
  // Flips the node's checked state on falling edge and optionally calls
  // the user's callback (for signal writes). Uses the pin-watching system.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "onToggle" &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    ts.isIdentifier(call.expression.expression.expression)
  ) {
    const treeName = call.expression.expression.expression.text;
    const elemId = call.expression.expression.name.text;
    const pinArg = call.arguments[0];
    const cbArg = call.arguments[1];
    const pin = pinArg ? (ts.isNumericLiteral(pinArg) ? pinArg.text : pinArg.getText()) : "0";

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId) : 0;
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }

    const fnName = `__ui_${elemId}_toggle_${watchPinSpecs().length}`;
    const prelude: StatementIR[] = [
      {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        callee: "__EMIT__",
        args: [{
          kind: "string",
          value: `__ui_nodes[${nodeIndex}].value = !__ui_nodes[${nodeIndex}].value; ui_mark_dirty(${nodeIndex})`,
        }],
      },
    ];
    const { bodyStatements, sourceSpan } = lowerPreludeCallback(
      cbArg, fileName, sourceText, diagnostics, `screen.${elemId}.onToggle`, prelude,
    );
    recordWatchPin({ pin: String(pin), fnName, callbackBody: "", bodyStatements, sourceSpan });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── screen.input.onChange(callback) — input text committed via keyboard ─
  // Distinct from the GPIO onChange below: this variant takes a single callback
  // arg (no pin/count) and fires after ui_kb_close commits the typed text.
  // Also handles <range> onChange — routed to "rangechange" and fired from the
  // drag loop on every value change during a slider drag.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "onChange" &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    ts.isIdentifier(call.expression.expression.expression) &&
    call.arguments.length === 1
  ) {
    const treeName = call.expression.expression.expression.text;
    const elemId = call.expression.expression.name.text;
    const cbArg = call.arguments[0];

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId) : 0;
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }
    const nodeTag = htmlPath ? resolveNodeTag(htmlPath, elemId) : "";

    const kind = nodeTag === "range" ? "rangechange" : "change";
    const lowered = lowerVoidEventCallback(
      cbArg, fileName, sourceText, diagnostics, `screen.${elemId}.onChange`,
    );
    const fnName = lowered.isNamedRef && lowered.namedFn
      ? lowered.namedFn
      : `__ui_${elemId}_${kind}_${clickHandlers().length}`;
    recordClickHandler({
      nodeIndex,
      kind,
      fnName,
      callbackBody: "",
      bodyStatements: lowered.bodyStatements,
      isNamedRef: lowered.isNamedRef,
      sourceSpan: lowered.sourceSpan,
    });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── screen.modeSelect.onChange(pin, optionCount, callback?) ───────────
  // Cycles .value through 0..optionCount-1 on each falling edge.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "onChange" &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    ts.isIdentifier(call.expression.expression.expression)
  ) {
    const treeName = call.expression.expression.expression.text;
    const elemId = call.expression.expression.name.text;
    const pinArg = call.arguments[0];
    const countArg = call.arguments[1];
    const cbArg = call.arguments[2];
    const pin = pinArg ? (ts.isNumericLiteral(pinArg) ? pinArg.text : pinArg.getText()) : "0";
    const optionCount = countArg ? (ts.isNumericLiteral(countArg) ? countArg.text : "2") : "2";

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId) : 0;
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }

    const fnName = `__ui_${elemId}_change_${watchPinSpecs().length}`;
    const prelude: StatementIR[] = [
      {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        callee: "__EMIT__",
        args: [{
          kind: "string",
          value: `__ui_nodes[${nodeIndex}].value = (__ui_nodes[${nodeIndex}].value + 1) % ${optionCount}; ui_mark_dirty(${nodeIndex})`,
        }],
      },
    ];
    const { bodyStatements, sourceSpan } = lowerPreludeCallback(
      cbArg, fileName, sourceText, diagnostics, `screen.${elemId}.onChange`, prelude,
    );
    recordWatchPin({ pin: String(pin), fnName, callbackBody: "", bodyStatements, sourceSpan });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── screen.element.onClick(callback?) — touch click handler ──────────
  // Records a click handler for touch hit-testing. No pin needed — the
  // touch poll loop calls ui_handle_touch which hit-tests and dispatches.
  // Supports both flat (screen.<id>) and grouped (screen.groups.<sid>.<id>).
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "onClick"
  ) {
    const recv = resolveElementReceiver(call.expression.expression);
    if (recv) {
    const treeName = recv.treeName;
    const elemId = recv.elemId;
    const cbArg = call.arguments[0];

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId, recv.screenId) : 0;
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }

    const lowered = lowerVoidEventCallback(
      cbArg, fileName, sourceText, diagnostics, `screen.${elemId}.onClick`,
    );
    const fnName = lowered.isNamedRef && lowered.namedFn
      ? lowered.namedFn
      : `__ui_${elemId}_click_${clickHandlers().length}`;
    recordClickHandler({
      nodeIndex,
      kind: "click",
      fnName,
      callbackBody: "",
      bodyStatements: lowered.bodyStatements,
      isNamedRef: lowered.isNamedRef,
      sourceSpan: lowered.sourceSpan,
    });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
    }  // end if (recv)
  }

  // ── screen.element.onHold/onRelease — touch long-press + release handlers ─
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    (call.expression.name.text === "onHold" || call.expression.name.text === "onRelease") &&
    ts.isPropertyAccessExpression(call.expression.expression) &&
    ts.isIdentifier(call.expression.expression.expression)
  ) {
    const kind = call.expression.name.text === "onHold" ? "hold" : "release";
    const treeName = call.expression.expression.expression.text;
    const elemId = call.expression.expression.name.text;
    const cbArg = call.arguments[0];

    const htmlPath = resolveUIModuleImport(treeName);
    const nodeIndex = htmlPath ? resolveNodeIndex(htmlPath, elemId) : 0;
    if (nodeIndex < 0) {
      pushUnknownElementDiagnostic(diagnostics, `screen.${elemId}.${call.expression.name.text}`, elemId, treeName);
      return { kind: "block", sourceSpan: makeSourceSpan(call, fileName, sourceText), leadingComments: comments.leadingComments, trailingComments: comments.trailingComments, body: [] };
    }

    const lowered = lowerVoidEventCallback(
      cbArg, fileName, sourceText, diagnostics, `screen.${elemId}.${call.expression.name.text}`,
    );
    const fnName = lowered.isNamedRef && lowered.namedFn
      ? lowered.namedFn
      : `__ui_${elemId}_${kind}_${clickHandlers().length}`;
    recordClickHandler({
      nodeIndex,
      kind,
      fnName,
      callbackBody: "",
      bodyStatements: lowered.bodyStatements,
      isNamedRef: lowered.isNamedRef,
      sourceSpan: lowered.sourceSpan,
    });

    return {
      kind: "block",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      body: [],
    };
  }

  // ── emit() / rawCpp() — compile-time C++ injection ─────────────────────
  // Must be BEFORE the HAL resolver — emit/rawCpp are exported from @typecad/hal
  // but are NOT HAL class methods. The HAL resolver would create a pseudo-instance
  // and fail to find a method body, leaving the call unresolved.
  if (ts.isIdentifier(call.expression) && (call.expression.text === "emit" || call.expression.text === "rawCpp")) {
    return {
      kind: "call",
      sourceSpan: makeSourceSpan(call, fileName, sourceText),
      leadingComments: comments.leadingComments,
      trailingComments: comments.trailingComments,
      callee: "__EMIT__",
      args: call.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars)),
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

  // ---- safe.* — @typecad/safety authoring calls (statement position) ---
  // Handles statement-position safe.* calls like safe.pinMode(pin, mode).
  // The expression-position form (const r = safe.read(pin)) is handled in
  // the variable-declaration transformer. Both produce hal-op IR nodes that
  // routeHALOp() later dispatches to the safety hook.
  const safetyResolved = tryResolveSafetyCallStatement(call, fileName, sourceText);
  if (safetyResolved) return safetyResolved;

  // ---- safe.read/safe.write chained with .ok/.fail/.fault/.always (statement) ----
  // A statement like `safe.read(pin).ok(r => {...}).fail(r => {...})` is a
  // method chain on a safe.* result. The terminal safe.* interceptor above
  // returns null for it (the shape isn't `safe.<method>` — it's `.fail` on a
  // chain). Delegate to expressionToIR, which has tryResolveSafetyChain to
  // build the structured nested method-call IR that preserves lambda args,
  // then render to text for a __RAW_STMT__ statement.
  if (hasSafetyHook() && ts.isPropertyAccessExpression(call.expression)) {
    let walk: ts.Node = call;
    let isSafeChain = false;
    while (ts.isCallExpression(walk) && ts.isPropertyAccessExpression(walk.expression)) {
      walk = walk.expression.expression;
      if (
        ts.isCallExpression(walk) &&
        ts.isPropertyAccessExpression(walk.expression) &&
        ts.isIdentifier(walk.expression.expression) &&
        walk.expression.expression.text === "safe"
      ) {
        isSafeChain = true;
        break;
      }
    }
    if (isSafeChain) {
      // Build the structured chain IR via expressionToIR (the chain resolver
      // produces nested method-call nodes with receiverExpr so lambdas survive).
      // Carry it as the arg of a __EXPR_STMT__ call statement; the statement
      // renderer renders it via the EMIT-TIME expression renderer (which has
      // renderLambda for inline [&](){...} lambdas), NOT via the build-time
      // renderExprAsText (which flattens lambdas to /* __lambda__ */).
      const exprIR = expressionToIR(call, sourceText, diagnostics, pointerVars);
      return {
        kind: "call",
        sourceSpan: makeSourceSpan(call, fileName, sourceText),
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        callee: "__EXPR_STMT__",
        args: [exprIR],
      };
    }
  }

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

  return {
    kind: "call",
    sourceSpan: makeSourceSpan(call, fileName, sourceText),
    leadingComments: comments.leadingComments,
    trailingComments: comments.trailingComments,
    callee: calleeText,
    args: call.arguments.map((arg) => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
  };
}

// ── Helper: lower a callback expression to C++ text ─────────────────────────
// (Moved to ui-callback-lowering.ts so onToggle and watchPin share one path,
// including console.* → platform transform which lived in neither copy.)
