import ts from "typescript";
import { Diagnostic } from "../types.js";
import { ExpressionIR, StatementIR } from "../api/index.js";
import { makeDiagnostic, makeSourceSpan } from "./ast-node-utils.js";
import { PointerTracker, PIN_FACTORY_FUNCTIONS, CONSTANT_FOLD_FUNCTIONS, TYPED_ARRAY_ELEMENT_MAP, activeCArrayVars, activeArrayLiteralVars, activeStringVars, nestedFunctionAliases, nestedClassAliases, registerFieldMap, hoistedNestedClasses, mutableArrayVars, arrayLiteralSizes, filteredArrayLengthVars, activeNamespaceNames, activeEnumNames, activeStringEnumNames, topLevelClassNames, topLevelInterfaceNames, classTypeNames, topLevelClasses, getActiveExtendsClass, restParamFunctions, getContext, getCurrentBoardConstants } from "./build-ir-state.js";
import { getCurrentIrTypeScope, type IrTypeScope } from "./symbol-types.js";
import { renderExprAsText } from "./render-expr.js";
import { lowerStatement, tryResolveHALExpression } from "./statement-to-ir.js";
import { isSignalName, resolveElementValue } from "./transformers/ui-call-resolver.js";
import { getCanvasAmbientCtx } from "./transformers/ui-callback-lowering.js";
import { halInstances } from "./hal-resolver.js";
import { escapeCppKeyword } from "../utils/strings.js";
import { tryLowerRegisterRead } from "./transformers/register-assignment.js";
import { tryLowerArrayAndStringMethods } from "./transformers/array-methods.js";
import { collectReturns, inferExprCppType, typeNodeToCppType, type CppTypeHint } from "./type-resolution.js";
import { parseCppType, elementOf, renderCppType, isPointer, bareType, parsedIsPointer, parsedIsVector, parsedIsMap, parsedIsSet, parsedIsTuple, parsedIsStdString, parsedElementString, parsedBareString, isVector, isMap, isSet, isContainer } from "../api/shared/cpp-type-ir.js";
import { hasSafetyHook, requireSafetyHook } from "../safety-hook.js";

function resolveExprCppType(expr: ts.Expression): string | undefined {
  if (ts.isNonNullExpression(expr) || ts.isParenthesizedExpression(expr)) {
    return resolveExprCppType(expr.expression);
  }
  if (ts.isIdentifier(expr)) {
    const scope = getCurrentIrTypeScope();
    const t = scope?.locals.get(expr.text) ?? scope?.globals.get(expr.text);
    return t && t !== "auto" ? t : undefined;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const fieldKey = `this->${expr.name.text}`;
      const scope = getCurrentIrTypeScope();
      const fieldType = scope?.classFields.get(fieldKey) ?? scope?.locals.get(fieldKey);
      return fieldType && fieldType !== "auto" ? fieldType : undefined;
    }
    const receiverType = resolveExprCppType(expr.expression);
    if (!receiverType) return undefined;
    const className = receiverType.replace(/\*$/, "");
    const classDef = topLevelClasses.get(className);
    if (!classDef) return undefined;
    const field = classDef.fields.find(f => f.name === expr.name.text);
    return field ? (field.cppType as string) : undefined;
  }
  if (ts.isElementAccessExpression(expr)) {
    const containerType = resolveExprCppType(expr.expression);
    if (!containerType) return undefined;
    // One structured elementOf lookup replaces the vector / __tc_StaticArray
    // inline parsers (the latter was a hand-rolled depth counter for the
    // first template arg).
    const elemIr = elementOf(parseCppType(containerType));
    if (elemIr) return renderCppType(elemIr);
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const receiver = expr.expression.expression;
    const methodName = expr.expression.name.text;
    if (ts.isIdentifier(receiver) && topLevelClasses.has(receiver.text)) {
      return topLevelClasses.get(receiver.text)?.methods.find((method) => method.name === methodName)?.returnType;
    }
    const receiverType = resolveExprCppType(receiver);
    if (!receiverType) return undefined;
    // Peel pointer via structured bareType to recover the class name.
    const className = (() => {
      const bare = bareType(parseCppType(receiverType));
      return bare.kind === "named" ? bare.name : "";
    })();
    return topLevelClasses.get(className)?.methods.find((method) => method.name === methodName)?.returnType;
  }
  return undefined;
}

/**
 * Infer the C++ element type of an array literal from its first element's
 * resolved cppType. Used so an INLINE array literal that flows into a
 * `__tc_*` template helper (`[...].join(sep)`, `[...].concat(x)`, ...) renders
 * as a TYPED `std::vector<ElemType>{...}` — a bare brace-init-list cannot drive
 * template argument deduction, but a typed temporary can.
 *
 * Returns the resolved cppType of the first element (e.g. `"std::string"` for
 * `['a', 'b']`, `"int32_t"` for `[1, 2]`), or `"auto"` if no element carries a
 * resolvable type. The `"auto"` fallback preserves the historical behavior for
 * direct-initialization contexts (`const T x = {...}`), where a bare brace list
 * is correct. Demo #29 Finding D.
 */
function inferArrayElementType(tsElements: ts.Expression[]): string {
  for (const elem of tsElements) {
    const t = resolveExprCppType(elem);
    if (t && t !== "auto") {
      // A typed element (identifier/member-access/element-access) carries its
      // declared cppType. Use it directly.
      return t;
    }
    // Literal elements: resolve their cppType from the literal kind so a
    // numeric/string/boolean literal array also gets a typed vector.
    if (ts.isStringLiteral(elem) || ts.isNoSubstitutionTemplateLiteral(elem)) {
      return "std::string";
    }
    if (ts.isNumericLiteral(elem)) {
      // Float-looking literal → double, else int. Mirrors inferNumericCppType.
      return /[.eE]/.test(elem.text) ? "double" : "int";
    }
    if (elem.kind === ts.SyntaxKind.TrueKeyword || elem.kind === ts.SyntaxKind.FalseKeyword) {
      return "bool";
    }
  }
  return "auto";
}

/**
 * Math.* constant property accesses that lower to a numeric literal rather
 * than `std::<name>` (which doesn't exist — `std::` has no PI/E members).
 * Using literals avoids `<cmath>`/`M_PI` `_USE_MATH_DEFINES` portability
 * issues on Windows/MSVC. Mirrors the TS `Math` constant values.
 */
const MATH_CONSTANT_LITERALS: Record<string, number> = {
  PI: 3.141592653589793,
  E: 2.718281828459045,
  LN2: 0.6931471805599453,
  LN10: 2.302585092994046,
  LOG2E: 1.4426950408889634,
  LOG10E: 0.4342944819032518,
  SQRT2: 1.4142135623730951,
  SQRT1_2: 0.7071067811865476,
};

/**
 * Resolve the declared C++ return type of a call expression, for the sole
 * purpose of the `valueType === null` null-comparison guard. Returns the type
 * (null-stripped, e.g. `Account` for `Account | null`) or `undefined`.
 *
 * Handles the two inline-call forms the guard needs:
 *  - `freeFn(args)` — a top-level `function` declaration's annotated return
 *    type, looked up from the source file (the IR `functionReturnTypes` map is
 *    not reachable here).
 *  - `this.method(args)` / `expr.method(args)` — a class method's return type,
 *    resolved via the top-level class registry (methods carry `returnType`).
 *
 * Demo #18 Finding A: without this, `findAccount(1) === null` and
 * `this.find(1) === null` lower to the invalid `call() == CUTTLEFISH_UNDEFINED`.
 */
function resolveCallReturnTypeForNullGuard(call: ts.CallExpression, sourceText: string): string | undefined {
  const callee = call.expression;
  // `this.method(...)` or `someExpr.method(...)`.
  if (ts.isPropertyAccessExpression(callee)) {
    const methodName = callee.name.text;
    // Resolve the receiver class. `this` could be any top-level class; look up
    // the method name across all of them (method names are usually unique
    // within a file). For an identifier receiver, infer its class from the
    // active type maps.
    let candidateClassNames: string[] = [];
    if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
      candidateClassNames = Array.from(topLevelClassNames);
    } else if (ts.isIdentifier(callee.expression)) {
      const recvType = getCurrentIrTypeScope()?.locals.get(callee.expression.text) ?? getCurrentIrTypeScope()?.globals.get(callee.expression.text);
      if (recvType) candidateClassNames = [recvType.replace(/\*$/, "").replace(/^const\s+/, "")];
    }
    for (const className of candidateClassNames) {
      const classDef = topLevelClasses.get(className);
      if (classDef) {
        const method = classDef.methods.find(m => m.name === methodName);
        if (method) return method.returnType as string | undefined;
      }
    }
    return undefined;
  }
  // `freeFn(...)` — scan the source file for the function declaration.
  if (ts.isIdentifier(callee)) {
    const fnName = callee.text;
    const sourceFile = call.getSourceFile();
    let declaredReturnType: ts.TypeNode | undefined;
    const visit = (node: ts.Node): void => {
      if (declaredReturnType) return;
      if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) {
        declaredReturnType = node.type;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    if (declaredReturnType) {
      return typeNodeToCppType(declaredReturnType);
    }
    return undefined;
  }
  return undefined;
}

/** The SafeReadResult/SafeWriteResult chain methods whose lambda args must
 *  render inline (preserving closure captures). Detected on the TS chain to
 *  decide whether to take the structured-receiver path. */
const SAFETY_RESULT_CHAIN_METHODS = new Set(["ok", "fail", "fault", "always"]);

/** Detect `safe.<read|write>(...).<ok|fail|fault|always>(handler)...` chains
 *  and build them as nested method-call IR nodes with a STRUCTURED receiverExpr
 *  (not a flattened callee string). This preserves inner lambda args so the
 *  emit pipeline can render them inline via renderLambda.
 *
 *  Returns null when the expression is not a safe.* call chained with at least
 *  one result method (terminal safe.read/safe.write are handled by the
 *  statement/var-decl interceptors; non-safe chains use the generic path). */
function tryResolveSafetyChain(
  expr: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: PointerTracker,
): ExpressionIR | null {
  if (!hasSafetyHook()) return null;

  // Walk down the property-access chain collecting (methodName, callNode) pairs.
  // For `safe.read(pin).ok(cb).fail(cb)`: the outermost expr is .fail(cb), whose
  // expression is the PropertyAccess `....fail`; its .expression is the .ok(cb)
  // call; THAT call's .expression.expression is the safe.read(pin) call; and the
  // safe.read call's .expression.expression is the identifier `safe`.
  // So each loop iteration: push the current call's method name, then descend to
  // cur.expression.expression (the receiver of the current property-access call).
  type ChainLink = { methodName: string; callNode: ts.CallExpression };
  const chain: ChainLink[] = [];
  let cur: ts.Expression = expr;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    chain.push({ methodName: cur.expression.name.text, callNode: cur });
    cur = cur.expression.expression;
  }

  // After the loop, `cur` is the innermost receiver. For a safe.* chain, the
  // last-pushed chain element is the safe.read/safe.write root (its
  // callNode.expression.expression is the identifier `safe`). Identify it.
  if (chain.length === 0) return null;
  const root = chain[chain.length - 1]!;
  const rootCall = root.callNode;
  // rootCall.expression is `safe.read` (PropertyAccess); rootCall.expression.expression
  // must be the identifier `safe` for this to be a safe.* root.

  // The root method is read/write; the links above it (chain[0..length-2]) must
  // include at least one result-chain method (ok/fail/fault/always).
  const resultLinks = chain.slice(0, chain.length - 1);
  const hasChainMethod = resultLinks.some((link) => SAFETY_RESULT_CHAIN_METHODS.has(link.methodName));
  if (!hasChainMethod) return null;

  // Resolve the safe.<method>(...) root to a hal-expr (the same way variables.ts
  // does for `const r = safe.read(pin)`). This becomes the innermost receiver.
  const rootPropAccess = rootCall.expression as ts.PropertyAccessExpression;
  const safeMethod = rootPropAccess.name.text;
  const argValues: unknown[] = rootCall.arguments.map((a) => {
    if (ts.isNumericLiteral(a)) return Number(a.text);
    if (ts.isStringLiteral(a)) return a.text;
    if (a.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (a.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(a)) return a.text;
    return a.getText();
  });
  const op = requireSafetyHook().resolveSemanticCall?.(`safe.${safeMethod}`, argValues);
  // If the hook couldn't resolve the pin (halInstances not yet populated for
  // this identifier at this point in IR building), fall back to rendering the
  // root verbatim. The chain structure (with inline lambdas) is still correct;
  // only the root's HAL resolution is deferred. This happens for multi-link
  // chains where the resolver runs before the pin's HAL instance is registered.
  let receiver: ExpressionIR;
  if (op) {
    receiver = { kind: "hal-expr", operation: op } as ExpressionIR;
  } else {
    // Best-effort: resolve the pin number directly from halInstances (the hook's
    // resolvePinArg does the same lookup, but calling it directly here avoids the
    // hook's early-return on unresolved pins).
    const pinArg = argValues[0];
    let pinNum: number | undefined;
    if (typeof pinArg === "string") {
      const inst = halInstances.get(pinArg);
      if (inst) {
        const pv = inst.fieldValues.get("_pin") ?? inst.fieldValues.get("pin");
        if (pv !== undefined) pinNum = Number(pv);
      }
    } else if (typeof pinArg === "number") {
      pinNum = pinArg;
    }
    if (pinNum !== undefined) {
      // Build the op manually now that we have the pin.
      const fallbackOp = safeMethod === "read"
        ? { operation: "safety.read_safe", pin: pinNum } as unknown
        : { operation: "safety.write_verify", pin: pinNum, value: argValues[1] ?? 0 } as unknown;
      receiver = { kind: "hal-expr", operation: fallbackOp } as ExpressionIR;
    } else {
      // Last resort: verbatim text. The chain renders but the root won't have
      // resolved to __tc_safety::read_safe — acceptable degradation.
      receiver = { kind: "raw", value: rootCall.getText() } as ExpressionIR;
    }
  }

  // The root renders as __tc_safety::read_safe(pin) — render it to text so the
  // callee string (used for non-receiverExpr consumers like type inference) is
  // correct.
  const rootText = renderExprAsText(receiver);

  // Build nested method-call nodes bottom-up over the RESULT links only
  // (chain[0..length-2], excluding the root at chain[length-1]). chain[0] is the
  // outermost call (e.g. .fail); we build from the innermost result link outward.
  for (let i = resultLinks.length - 1; i >= 0; i--) {
    const link = resultLinks[i]!;
    // Render this link's args as IR (lambdas become lambda IR nodes that
    // renderLambda handles at emit time).
    const argIRs = link.callNode.arguments.map((a) => expressionToIR(a, sourceText, diagnostics, pointerVars));
    // Set concrete param types on lambda args so renderLambda emits
    // `const SafeReadResult& r` instead of `auto r`. Generic lambdas (auto
    // params) require C++14; AVR's gnu++11 doesn't support them. The chain
    // knows the result type from the root (read -> SafeReadResult,
    // write -> SafeWriteResult).
    const resultType = safeMethod === "read" ? "SafeReadResult" : "SafeWriteResult";
    for (const argIR of argIRs) {
      if (argIR.kind === "lambda" && argIR.params) {
        for (const p of argIR.params) {
          if (!p.cppType || p.cppType === "auto") {
            p.cppType = `const ${resultType}&`;
          }
        }
      }
    }
    // Build a callee string for backward-compat with consumers that read
    // method-call.callee. The receiver text is rootText for the innermost link,
    // or the prior receiver's rendered text for outer links.
    const priorCallee = i === resultLinks.length - 1
      ? rootText
      : renderExprAsText(receiver);
    const callee = `${priorCallee}.${escapeCppKeyword(link.methodName, new Set<string>())}`;
    receiver = {
      kind: "method-call",
      callee,
      args: argIRs,
      methodName: link.methodName,
      receiverExpr: receiver,
    } as ExpressionIR;
  }

  return receiver;
}

export function expressionToIR(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[], pointerVars: PointerTracker = new Map()): ExpressionIR {
  function emitUnsupportedExpression(message: string): ExpressionIR {
    diagnostics.push(makeDiagnostic(
      sourceText,
      expr.pos,
      message,
      "error",
      "TS2CPP_UNSUPPORTED_EXPR",
    ));
    return { kind: "raw", value: "0 /* unsupported_expr */" };
  }

  function isOptionalChainNode(node: ts.Node): boolean {
    return !!(node as any).questionDotToken ||
      (typeof (ts as any).isOptionalChain === "function" && (ts as any).isOptionalChain(node));
  }

  /**
   * Resolve .length property access to the correct C++ expression.
   * Shared by both renderMemberAccessText and the main PropertyAccess handler
   * to ensure consistent behavior for top-level and nested .length access.
   *
   * Returns the C++ text. Special case: returns the filteredArrayLengthVars
   * variable name prefixed with "__FILTERED_LEN__" so the caller can detect it.
   */
  function resolveLengthProperty(receiverNode: ts.Expression, objectText: string): string {
    // UI element text: screen.<id>.text is a raw char buffer on the node —
    // `.length` must be strlen, not `.size()` (char[33] has no size member).
    if (
      ts.isPropertyAccessExpression(receiverNode) &&
      receiverNode.name.text === "text" &&
      ts.isPropertyAccessExpression(receiverNode.expression) &&
      ts.isIdentifier(receiverNode.expression.expression)
    ) {
      const nodeIdx = resolveElementValue(
        receiverNode.expression.expression.text,
        receiverNode.expression.name.text,
      );
      if (nodeIdx !== undefined) {
        return `static_cast<long long>(strlen(__ui_nodes[${nodeIdx}].textBuffer))`;
      }
    }
    if (ts.isStringLiteral(receiverNode) || ts.isNoSubstitutionTemplateLiteral(receiverNode)) {
      return `${receiverNode.text.length}`;
    }
    // Escape C++ keywords in identifier texts for generated C++ output
    const safeText = ts.isIdentifier(receiverNode) ? escapeCppKeyword(objectText) : objectText;
    if (ts.isIdentifier(receiverNode) && filteredArrayLengthVars.has(receiverNode.text)) {
      return `__FILTERED_LEN__${filteredArrayLengthVars.get(receiverNode.text)!}`;
    }
    // Demo #17 Finding C — activeCArrayVars is FUNCTION-SCOPED (cleared by
    // resetFunctionScopeState per function), so it is the authoritative signal
    // for THIS function's typed-array / raw-C-array locals. mutableArrayVars,
    // by contrast, is FILE-SCOPED (populated by a pre-scan and survives across
    // functions), so a name like `buf` that was mutated in fn1-fn4 stays in
    // mutableArrayVars when a DIFFERENT `buf` (a `new Uint8Array([...])`
    // literal) is declared in fn5. Checking activeCArrayVars FIRST prevents the
    // stale file-level mutableArrayVars entry from forcing the function-local
    // raw C array down the `.size()` path (avr-g++: "request for member 'size'
    // in 'buf', which is of non-class type 'uint8_t [5]'").
    if (ts.isIdentifier(receiverNode) && activeCArrayVars.has(receiverNode.text)) {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && mutableArrayVars.has(receiverNode.text)) {
      // std::vector has no `.length()` member (that's std::string); use
      // `.size()`. Cast to long long to match loop-counter type and avoid
      // -Wsign-compare. Demo #27 Finding C — this branch (function-local
      // mutable array) and the array-literal branch below previously emitted
      // the invalid `vector.length()`. The `this->field` path was already
      // corrected by demo #22 fix F; this closes the bare-local-identifier
      // hole.
      return `static_cast<long long>(${safeText}.size())`;
    }
    if (ts.isIdentifier(receiverNode) && activeArrayLiteralVars.has(receiverNode.text)) {
      const varName = receiverNode.text;
      const varType = getCurrentIrTypeScope()?.locals.get(varName);
      // `.size()` is valid ONLY when the local actually lowered to something
      // with a `.size()` METHOD — a std::vector OR a promoted
      // __tc_StaticArray. A NON-mutated local array literal on a target that
      // does NOT need std::vector (`!strategy.needsStdVector()`, e.g. Arduino
      // AVR) lowers to a RAW C array (`T name[] = {...}`), even though its
      // varType still resolves to `std::vector<...>`, and a raw C array has NO
      // `.size()` member. The emit-side discriminator (class-emitter.ts
      // `addCArrayIfNotMutable`) uses exactly `!needsStdVector()` to decide
      // raw-C-array vs std::vector, so we mirror it here. Previously this
      // branch tested only the varType prefix, so a read-only local literal
      // emitted `name.size()` on a raw C array → avr-g++ "request for member
      // 'size' in 'name', which is of non-class type". `mutableArrayVars`
      // membership is the second signal: a mutated local is promoted to
      // __tc_StaticArray (variables.ts), which DOES have `.size()`. Demo #33.
      const emitsRawCArray = !getContext().activeStrategy?.needsStdVector();
      const loweredToContainer =
        (typeof varType === 'string' && varType.startsWith('StaticArray<')) ||
        (typeof varType === 'string' && varType.startsWith('std::vector<') && (!emitsRawCArray || mutableArrayVars.has(varName)));
      if (loweredToContainer) {
        // Demo #27 Finding C — `.size()` not `.length()` on a vector/StaticArray
        // local (see the mutableArrayVars comment above).
        return `static_cast<long long>(${safeText}.size())`;
      }
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isIdentifier(receiverNode) && getCurrentIrTypeScope()?.locals.get(receiverNode.text) === "auto") {
      return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
    }
    if (ts.isCallExpression(receiverNode)) {
      // Case B: a HAL buffer-returning method (a device target's read
      // verbs) used INLINE as a sub-expression — e.g.
      // `dev.readBytes(0,6).length`. These methods lower to STATEMENTS (a fill
      // loop), not a single C++ expression, so by the time we get here the
      // receiver text is already a leaked `for (...) __buf[__i] = Wire.read()`
      // statement spliced where an expression is required. The buffer also has
      // no caller-side name to sizeof. Only the var-init form is supported
      // (`const data = dev.readBytes(...)`); emit a clear diagnostic so the
      // user gets an actionable error instead of inscrutable broken C++.
      if (/\bfor\s*\(/.test(safeText) || /__buf|__spi_buf/.test(safeText)) {
        const calleeName = ts.isPropertyAccessExpression(receiverNode.expression)
          ? receiverNode.expression.name.text : "call";
        diagnostics.push(makeDiagnostic(
          sourceText,
          receiverNode.getStart(),
          `\`${calleeName}(...)\` returns a buffer and cannot be queried inline. Capture it into a variable first (e.g. \`const data = ${calleeName}(...)\`), then use \`data.length\`.`,
          "error",
          "TC_BUFFER_INLINE_LENGTH",
        ));
        return `0 /* ${calleeName}() result must be captured into a variable to use .length */`;
      }
      // Resolve the call's RETURN type (not the receiver object's type, which
      // the previous code incorrectly did). Method calls resolve via the class
      // registry; free-function calls resolve by scanning the source AST for
      // the declared return type.
      const returnType = resolveExprCppType(receiverNode)
        ?? resolveCallReturnTypeForNullGuard(receiverNode, sourceText);
      if (returnType) {
        const parsed = parseCppType(returnType);
        // std::string → .length(); any STL container (vector/map/set) → .size().
        if (parsedIsStdString(returnType)) {
          return `static_cast<long long>(${safeText}.length())`;
        }
        if (parsedIsVector(returnType) || parsedIsMap(returnType) || parsedIsSet(returnType) || isContainer(parsed)) {
          return `static_cast<long long>(${safeText}.size())`;
        }
        // A raw pointer / decayed-array return (e.g. uint8_t*) carries no size
        // at the call site — sizeof would yield sizeof(pointer). This is
        // genuinely un-sizeable inline; surface it rather than emit wrong code.
        if (parsedIsPointer(returnType) || /\]\s*$/.test(returnType)) {
          const calleeName = ts.isPropertyAccessExpression(receiverNode.expression)
            ? receiverNode.expression.name.text
            : (ts.isIdentifier(receiverNode.expression) ? receiverNode.expression.text : "call");
          diagnostics.push(makeDiagnostic(
            sourceText,
            receiverNode.getStart(),
            `Cannot use \`.length\` on \`${calleeName}()\` which returns a pointer (${returnType}); the size is not available at the call site. Capture the buffer into a variable first.`,
            "error",
            "TC_LENGTH_ON_POINTER_RETURN",
          ));
          return `0 /* .length unavailable on ${returnType} return */`;
        }
      }
      // Cast .size() to long long to match the loop-counter type (TS number ->
      // long long). Without this, `i < vec.size()` compares long long vs
      // size_t (unsigned) and g++ -Wall warns -Wsign-compare on every
      // indexed loop over an array. (Fallback for unresolvable return types —
      // historically every call-result .length landed here.)
      return `static_cast<long long>(${safeText}.size())`;
    }
    // Resolve by concrete cppType first so std::string vars render member calls
    // even when their resolved type is const char* (string-literal initialized).
    if (ts.isIdentifier(receiverNode)) {
      // locals holds function-scoped bindings; globals holds top-level
      // (module-scope) bindings, which survive resetFunctionScopeState. A
      // top-level `const S: int32_t[] = [...]` accessed inside a function is
      // only in globals, so fall back to it.
      const varType = getCurrentIrTypeScope()?.locals.get(receiverNode.text)
        ?? getCurrentIrTypeScope()?.globals.get(receiverNode.text);
      // Demo #17 Finding B — a typed-array local (`new Uint8Array([...])` /
      // `new Int8Array(N)`) lowers to a RAW C array whose cppType is a static
      // array spelling (`uint8_t[5]`, `int32_t[8]`) OR a bare element pointer
      // (`uint8_t*`). Both forms have NO `.size()` member, so `.length` must
      // lower to sizeof. The activeCArrayVars set is the canonical signal
      // (populated by the variable transformer for `new <TypedArray>(...)`);
      // the cppType shape check is a belt-and-braces fallback for cases where
      // registration was missed (e.g. initializer took a non-standard path).
      // Without this, `.length` fell through to the default `.size()` and
      // avr-g++ rejected it ("request for member 'size' in 'buf', which is of
      // non-class type 'uint8_t [5]'").
      const isRawCArrayType = typeof varType === 'string'
        && /\]\s*$/.test(varType); // ends with `[N]` or `[]`
      if (activeCArrayVars.has(receiverNode.text) || isRawCArrayType) {
        return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
      }
      if (varType === "std::string") {
        // Demo #30 Finding B — cast `std::string::length()` to `long long` so
        // it matches the array/vector `.size()` lowering (also `long long`)
        // AND the snprintf `%lld` format specifier. `std::string::length()`
        // returns `size_type` (unsigned), which g++ -Wformat= rejects against
        // `%d`/`%lld` and against `static_cast<long long>` only when NOT cast.
        // Casting here makes `.length` uniform across every string/array/
        // container receiver — one signed integral type, one format specifier.
        return `static_cast<long long>(${safeText}.length())`;
      }
      // Demo #33 Finding B — a top-level `const` array literal on a target
      // that does NOT need std::vector (`!strategy.needsStdVector()`, e.g.
      // Arduino AVR) emits as a RAW C array (`int32_t S[] = {...}`), even
      // though its declared type resolves to `std::vector<...>`. It is NOT in
      // `mutableArrayVars` (only mutated locals promote to StaticArray) NOR
      // in `activeArrayLiteralVars` (which resetFunctionScopeState clears
      // before each function, so a top-level array isn't visible from inside
      // a function body). So `.length` fell through to the default `.size()`
      // — invalid for a raw C array (avr-g++: "request for member 'size' in
      // 'S', which is of non-class type"). The emit-side discriminator
      // (class-emitter.ts `addCArrayIfNotMutable`) uses `!needsStdVector()`,
      // mirrored here: a top-level const array on a no-std::vector target is
      // a raw C array → sizeof. On native/generic (`needsStdVector()` true)
      // it really is a std::vector → .size(). The function-local path is
      // handled by the activeArrayLiteralVars branch above (FIX-4).
      if (typeof varType === 'string' && varType.startsWith('std::vector<')) {
        const emitsRawCArray = !getContext().activeStrategy?.needsStdVector();
        const isTopLevel = !getCurrentIrTypeScope()?.locals.has(receiverNode.text)
          && getCurrentIrTypeScope()?.globals.has(receiverNode.text);
        if (emitsRawCArray && isTopLevel) {
          return `(sizeof(${safeText}) / sizeof(${safeText}[0]))`;
        }
        return `static_cast<long long>(${safeText}.size())`;
      }
      if (varType === "const char*" || varType === "char*") {
        return `strlen(${safeText})`;
      }
      // Unresolved C-string variables (resolved const char*/char*/__tc_str_ptr) → strlen()
      if (activeStringVars.has(receiverNode.text)) {
        return `strlen(${safeText})`;
      }
    }
    // Handle this->field.length — route by the field's resolved C++ type. Every
    // STL container exposes .size(), so vector/map/set all lower correctly; only
    // a C-string field lowers to strlen. Previously a std::map/std::set field
    // fell through to the strlen default (the field type didn't match the
    // std::vector/StaticArray prefix), emitting strlen(this->m) on a struct —
    // invalid C++ that g++ rejects (or, worse, silently miscompiles). Demo #22
    // adjacency probe surfaced this pre-existing bug.
    if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const fieldType = getCurrentIrTypeScope()?.locals.get(`this->${receiverNode.name.text}`);
      if (fieldType === "std::string") return `static_cast<long long>(${safeText}.length())`;
      if (fieldType === "const char*" || fieldType === "char*") return `strlen(${safeText})`;
      // Container-like field (.size() applies). Covers std::vector, std::map,
      // std::set, and both __tc_StaticArray<T,N> and the bare StaticArray<T,N>
      // spelling (the latter parses as a named template, so check explicitly).
      if (fieldType) {
        const ir = parseCppType(fieldType);
        const isBareStaticArray = ir.kind === "named" && ir.name === "StaticArray";
        if (isContainer(ir) || isBareStaticArray) {
          return `static_cast<long long>(${safeText}.size())`;
        }
      }
      // Unknown field type — .size() is valid on every STL container and on
      // std::string, so default to it rather than the C-string strlen (which is
      // only correct for const char*). This matches the bare-identifier
      // fallback at the end of this function.
      return `static_cast<long long>(${safeText}.size())`;
    }
    return `static_cast<long long>(${safeText}.size())`;
  }

  function renderMemberAccessText(receiverNode: ts.Expression, memberName: string): string {
    const escapedName = escapeCppKeyword(memberName);
    const isThisAccess = receiverNode.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(receiverNode) && receiverNode.text === "this");
    if (isThisAccess) {
      if (memberName === "length") {
        return `static_cast<long long>(this->size())`;
      }
      return `this->${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && pointerVars.has(receiverNode.text)) {
      return `${receiverNode.text}->${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && receiverNode.text === "Math") {
      if (memberName === "random") return `__tc_random()`;
      const mathConst = MATH_CONSTANT_LITERALS[memberName];
      if (mathConst !== undefined) return String(mathConst);
      return `std::${escapedName}`;
    }
    if (ts.isIdentifier(receiverNode) && activeNamespaceNames.has(receiverNode.text)) {
      return `${receiverNode.text}::${escapedName}`;
    }
    const objectText = formatExpressionText(receiverNode);
    // Detect if receiver is a method call that returns a pointer (for chaining)
    if (ts.isCallExpression(receiverNode) && ts.isPropertyAccessExpression(receiverNode.expression)) {
      const innerReceiver = receiverNode.expression.expression;
      const innerMethodName = receiverNode.expression.name.text;
      if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
        let className = pointerVars.get(innerReceiver.text)!;
        className = nestedClassAliases.get(className) ?? className;
        const cls = hoistedNestedClasses.find(c => c.name === className);
        const chainMethod = cls?.methods.find(m => m.name === innerMethodName);
        if (chainMethod && parsedIsPointer(chainMethod.returnType as string)) {
          return `${objectText}->${escapedName}`;
        }
      }
    }
    if (memberName === "length" || memberName === "size") {
      const resolved = resolveLengthProperty(receiverNode, objectText);
      // Filtered length vars use a special prefix — extract the variable name
      if (resolved.startsWith("__FILTERED_LEN__")) {
        return resolved.slice("__FILTERED_LEN__".length);
      }
      return resolved;
    }
    return `${objectText}.${escapedName}`;
  }

  function renderOptionalGuardedAccess(receiverNode: ts.Expression, accessText: string): string {
    const receiverText = formatExpressionText(receiverNode);
    return `(cuttlefish_exists(${receiverText}) ? ${accessText} : 0)`;
  }

  const formatExpressionText = (node: ts.Expression): string => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return formatExpressionText(node.expression);
    }

    if (ts.isParenthesizedExpression(node)) {
      return `(${formatExpressionText(node.expression)})`;
    }

    if (ts.isPropertyAccessExpression(node)) {
      const accessText = renderMemberAccessText(node.expression, node.name.text);
      if (isOptionalChainNode(node)) {
        return renderOptionalGuardedAccess(node.expression, accessText);
      }
      return accessText;
    }

    if (ts.isElementAccessExpression(node)) {
      const objectText = formatExpressionText(node.expression);
      const argumentText = node.argumentExpression ? formatExpressionText(node.argumentExpression) : "0";
      return `${objectText}[${argumentText}]`;
    }

    if (ts.isCallExpression(node)) {
      const argsText = node.arguments.map((arg) => formatExpressionText(arg)).join(", ");
      if (isOptionalChainNode(node) && ts.isPropertyAccessExpression(node.expression)) {
        const calleeText = renderMemberAccessText(node.expression.expression, node.expression.name.text);
        return renderOptionalGuardedAccess(node.expression.expression, `${calleeText}(${argsText})`);
      }
      const calleeText = formatExpressionText(node.expression);
      return `${calleeText}(${argsText})`;
    }

    if (ts.isPrefixUnaryExpression(node)) {
      return `${node.operator === ts.SyntaxKind.PlusPlusToken ? "++" : node.operator === ts.SyntaxKind.MinusMinusToken ? "--" : ts.tokenToString(node.operator) ?? ""}${formatExpressionText(node.operand)}`;
    }

    if (ts.isBinaryExpression(node)) {
      let operator = ts.tokenToString(node.operatorToken.kind) ?? node.operatorToken.getText();
      if (operator === "===") {
        operator = "==";
      } else if (operator === "!==") {
        operator = "!=";
      } else if (operator === "??") {
        // Nullish coalescing must not use truthiness semantics because 0/false
        // are valid values in TypeScript. Emit a helper call instead.
        const left = formatExpressionText(node.left);
        const right = formatExpressionText(node.right);
        return `cuttlefish_nullish(${left}, ${right})`;
      } else if (operator === "**") {
        // C++ has no ** operator — translate to pow()
        const left = formatExpressionText(node.left);
        const right = formatExpressionText(node.right);
        return `pow(${left}, ${right})`;
      }
      return `${formatExpressionText(node.left)} ${operator} ${formatExpressionText(node.right)}`;
    }

    return node.getText();
  };

  if (ts.isNumericLiteral(expr)) {
    const numValue = Number(expr.text);
    // Use original source text to detect float literals â€” TypeScript normalizes "2.0" to "2" in expr.text
    const originalText = sourceText.substring(expr.pos, expr.end).trim();
    const isFloat = /[.eE]/.test(originalText);
    return { kind: "number" as const, value: numValue, ...(isFloat ? { cppType: "double" as const } : {}) };
  }

  if (expr.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const regexText = expr.getText();
    return { kind: "raw", value: `std::regex(${JSON.stringify(regexText)})` };
  }

  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    const inner = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    // When the cast involves an `enum class` on one side and an integral type
    // on the other, emit a `static_cast<T>(...)` instead of erasing. C++ enum
    // class has NO implicit conversion, so the erased cast produces invalid
    // C++. This is handled for specific sites (relational, index, Map key,
    // storage boundary) but NOT for the general `as` cast — the user's
    // explicit escape hatch (enum stress test Finding C).
    const targetTypeName = expr.type && ts.isTypeReferenceNode(expr.type) && ts.isIdentifier(expr.type.typeName)
      ? expr.type.typeName.text : "";
    const isTargetEnum = targetTypeName && activeEnumNames.has(targetTypeName) && !activeStringEnumNames.has(targetTypeName);
    if (isTargetEnum) {
      // int → enum: static_cast<EnumType>(value)
      return { kind: "raw", value: `static_cast<${targetTypeName}>(${renderExprAsText(inner)})` };
    }
    // enum → int: detect if the source expression is an enum-typed identifier
    // or enum member access, and the target is an integral C++ type.
    const isIntegralTarget = targetTypeName && /^(int|long|short|char|double|float|uint|int8|int16|int32|int64|size_t)/.test(targetTypeName);
    if (isIntegralTarget) {
      // Check if the inner expression is an enum-typed value. An identifier
      // may be an enum-typed VARIABLE (param, local) — resolve its type from
      // the IR type scope's locals/globals. An enum member access
      // (Mode.Run) resolves via the enum name on the object.
      const innerExpr = expr.expression;
      let sourceEnumName = "";
      if (ts.isIdentifier(innerExpr)) {
        // Direct enum name (e.g. `Mode` used as a value).
        if (activeEnumNames.has(innerExpr.text) && !activeStringEnumNames.has(innerExpr.text)) {
          sourceEnumName = innerExpr.text;
        } else {
          // Variable whose type is an enum — resolve from locals/globals.
          const varType = getCurrentIrTypeScope()?.locals.get(innerExpr.text)
            ?? getCurrentIrTypeScope()?.globals.get(innerExpr.text);
          if (varType && activeEnumNames.has(varType) && !activeStringEnumNames.has(varType)) {
            sourceEnumName = varType;
          }
        }
      } else if (ts.isPropertyAccessExpression(innerExpr) && ts.isIdentifier(innerExpr.expression)
                 && activeEnumNames.has(innerExpr.expression.text) && !activeStringEnumNames.has(innerExpr.expression.text)) {
        sourceEnumName = innerExpr.expression.text;
      }
      if (sourceEnumName) {
        return { kind: "raw", value: `static_cast<${targetTypeName}>(${renderExprAsText(inner)})` };
      }
    }
    return inner;
  }

  if (ts.isAwaitExpression(expr)) {
    return {
      kind: "await",
      value: expressionToIR(expr.expression, sourceText, diagnostics, pointerVars),
    };
  }

  if (expr.kind === ts.SyntaxKind.VoidExpression) {
    const voidExpr = expr as ts.VoidExpression;
    const inner = expressionToIR(voidExpr.expression, sourceText, diagnostics, pointerVars);
    const innerText = renderExprAsText(inner);
    return { kind: "raw", value: `(void)(${innerText}), CUTTLEFISH_UNDEFINED` };
  }

  // Handle 'as const' and other type assertions - unwrap and process inner expression
  if (ts.isAsExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle type assertions like (<Type>expr) - unwrap and process inner expression
  if (ts.isTypeAssertionExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  // Handle 'satisfies' expressions (TS 4.9+) - unwrap and process inner expression
  if ((ts as any).isSatisfiesExpression?.(expr)) {
    return expressionToIR((expr as any).expression, sourceText, diagnostics, pointerVars);
  }
  if (expr.kind === (ts.SyntaxKind as any).SatisfiesExpression) {
    return expressionToIR((expr as any).expression, sourceText, diagnostics, pointerVars);
  }

  // Handle instanceof expressions (must be before generic binary expression handling)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Handle 'in' operator: "key" in obj → map.count() or vector find
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InKeyword) {
    const left = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const rightNode = expr.right;
    let rightVarType: string | undefined;
    if (ts.isIdentifier(rightNode)) {
      rightVarType = getCurrentIrTypeScope()?.locals.get(rightNode.text) ?? getCurrentIrTypeScope()?.globals.get(rightNode.text);
    }
    if (rightVarType && parsedIsMap(rightVarType)) {
      return { kind: "raw", value: `(${rightNode.getText()}.count(${left}) > 0)` };
    }
    if (rightVarType && parsedIsVector(rightVarType)) {
      return { kind: "raw", value: `(std::find(${rightNode.getText()}.begin(), ${rightNode.getText()}.end(), ${left}) != ${rightNode.getText()}.end())` };
    }
    if (rightVarType && parsedIsSet(rightVarType)) {
      return { kind: "raw", value: `(${rightNode.getText()}.count(${left}) > 0)` };
    }
    return { kind: "raw", value: `(std::find(${rightNode.getText()}.begin(), ${rightNode.getText()}.end(), ${left}) != ${rightNode.getText()}.end())` };
  }

  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) {
    const leftText = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const rightText = renderExprAsText(expressionToIR(expr.right, sourceText, diagnostics, pointerVars));
    return { kind: "raw", value: `static_cast<unsigned int>(static_cast<unsigned int>(${leftText}) >> ${rightText})` };
  }

  // Detect string-bearing + chains and fold them into string_concat IR so they
  // flow through the same snprintf / std::string pipeline that template literals use.
  const STRING_RETURNING_METHODS = new Set([
    'toUpperCase', 'toLowerCase', 'trim', 'replace',
    'charAt', 'substring', 'slice', 'endsWith', 'includes', 'toString',
  ]);

  const ALL_STRING_METHODS = new Set([
    'toUpperCase', 'toLowerCase', 'trim', 'replace', 'charAt', 'charCodeAt',
    'substring', 'slice', 'endsWith', 'startsWith', 'includes', 'indexOf',
    'lastIndexOf', 'padStart', 'padEnd', 'repeat', 'split', 'toString',
  ]);
  function isStringBearingConcatChain(e: ts.Expression): boolean {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return true;
    if (ts.isIdentifier(e)) {
      if (activeStringVars.has(e.text) || getCurrentIrTypeScope()?.locals.get(e.text) === "std::string") return true;
      const varType = getCurrentIrTypeScope()?.locals.get(e.text) ?? getCurrentIrTypeScope()?.globals.get(e.text);
      if (varType === "const char*" || varType === "char*") return true;
      // A variable whose declared type is a string enum holds a const char*.
      if (varType && activeStringEnumNames.has(varType)) return true;
      if (process.env.CF_ENUM_DEBUG && e.text === "c") {
        console.error("[CF_ENUM_DEBUG] c varType=", JSON.stringify(varType), "stringEnums=", JSON.stringify([...activeStringEnumNames]));
      }
    }
    if (ts.isParenthesizedExpression(e)) {
      return isStringBearingConcatChain(e.expression);
    }
    if (ts.isConditionalExpression(e)) {
      return isStringBearingConcatChain(e.whenTrue) || isStringBearingConcatChain(e.whenFalse);
    }
    if (ts.isPropertyAccessExpression(e)) {
      if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const fieldType = getCurrentIrTypeScope()?.locals.get(`this->${e.name.text}`);
        if (fieldType === "std::string" || fieldType === "const char*" || fieldType === "char*") return true;
      }
      if (ts.isIdentifier(e.expression)) {
        const objType = getCurrentIrTypeScope()?.locals.get(e.expression.text) ?? getCurrentIrTypeScope()?.globals.get(e.expression.text);
        if (objType) {
          const className = objType.replace(/\*$/, "");
          const classDef = topLevelClasses.get(className);
          if (classDef) {
            const field = classDef.fields.find(f => f.name === e.name.text);
            if (field) {
              const ft = field.cppType;
              if (ft === "std::string" || ft === "const char*" || ft === "char*") return true;
            }
          }
        }
      }
      // Handle chained property access: s.player.weaponName where the
      // receiver is itself a property access (e.g. local pointer alias).
      if (ts.isPropertyAccessExpression(e.expression)) {
        const receiverType = resolveExprCppType(e.expression);
        if (receiverType) {
          const className = receiverType.replace(/\*$/, "");
          const classDef = topLevelClasses.get(className);
          if (classDef) {
            const field = classDef.fields.find(f => f.name === e.name.text);
            if (field) {
              const ft = field.cppType;
              if (ft === "std::string" || ft === "const char*" || ft === "char*") return true;
            }
          }
        }
      }
    }
    if (ts.isCallExpression(e)) {
      const callType = resolveExprCppType(e);
      if (callType === "std::string" || callType === "const char*" || callType === "char*") return true;
      if (ts.isPropertyAccessExpression(e.expression)) {
        const methodName = e.expression.name.text;
        if (STRING_RETURNING_METHODS.has(methodName)) return true;
        if (ts.isIdentifier(e.expression.expression)) {
          const receiverType = getCurrentIrTypeScope()?.locals.get(e.expression.expression.text);
          if (receiverType === "std::string" || receiverType === "const char*" || activeStringVars.has(e.expression.expression.text)) return true;
        }
        if (ts.isPropertyAccessExpression(e.expression.expression) && e.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const fieldType = getCurrentIrTypeScope()?.locals.get(`this->${e.expression.expression.name.text}`);
          if (fieldType === "std::string" || fieldType === "const char*") return true;
        }
      }
      if (ts.isIdentifier(e.expression)) {
        const fnName = e.expression.text;
        const returnType = getCurrentIrTypeScope()?.locals.get(`fn:${fnName}`) ?? getCurrentIrTypeScope()?.globals.get(`fn:${fnName}`);
        if (returnType === "std::string" || returnType === "const char*") return true;
      }
    }
    if (ts.isElementAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const arrType = getCurrentIrTypeScope()?.locals.get(e.expression.text) ?? getCurrentIrTypeScope()?.globals.get(e.expression.text);
      if (arrType) {
        // Element type of a vector, checked for string-ness.
        const elemStr = parsedElementString(arrType);
        if (elemStr && (elemStr === "std::string" || elemStr === "const char*")) return true;
      }
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return isStringBearingConcatChain(e.left) || isStringBearingConcatChain(e.right);
    }
    return false;
  }

  function flattenStringConcatParts(e: ts.Expression): ExpressionIR[] {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return e.text ? [{ kind: "string", value: e.text }] : [];
    }
    if (ts.isTemplateExpression(e)) {
      const nested = expressionToIR(e, sourceText, diagnostics, pointerVars);
      return nested.kind === "string_concat" ? nested.parts : [nested];
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      isStringBearingConcatChain(e)
    ) {
      return [
        ...flattenStringConcatParts(e.left),
        ...flattenStringConcatParts(e.right),
      ];
    }
    return [{ kind: "template_string", expression: expressionToIR(e, sourceText, diagnostics, pointerVars) }];
  }

  // Route string-bearing + chains into string_concat IR (same path as template literals).
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    isStringBearingConcatChain(expr)
  ) {
    const parts = flattenStringConcatParts(expr);
    if (parts.length === 1) return parts[0];
    return { kind: "string_concat", parts };
  }

  // Nullish coalescing: use a helper instead of truthiness so that
  // values like 0 and false are preserved correctly.
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = renderExprAsText(expressionToIR(expr.left, sourceText, diagnostics, pointerVars));
    const right = renderExprAsText(expressionToIR(expr.right, sourceText, diagnostics, pointerVars));
    return { kind: "raw", value: `cuttlefish_nullish(${left}, ${right})` };
  }

  // Detect type guard pattern: typeof x == "literal" or typeof x != "literal"
  // where x has a known type. Emit a compile-time constant to avoid dead code.
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
    const leftIsTypeof = ts.isTypeOfExpression(expr.left);
    const rightIsString = ts.isStringLiteral(expr.right);
    if (leftIsTypeof && rightIsString) {
      const typeofOperand = expr.left.expression;
      if (ts.isIdentifier(typeofOperand)) {
        const varType = getCurrentIrTypeScope()?.locals.get(typeofOperand.text);
        const expectedTypeName = expr.right.text;
        const actualTypeName = varType === "int" || varType === "float" || varType === "double" || varType === "long" || varType === "long long" || varType === "unsigned long long" || varType === "unsigned" || varType === "size_t"
          ? "number"
          : varType === "bool"
            ? "boolean"
            : varType === "std::string"
              ? "string"
              : varType === "void"
                ? "undefined"
                : "object";
        const isEquality = expr.operatorToken.kind === ts.SyntaxKind.EqualsToken || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
        const matches = actualTypeName === expectedTypeName;
        return { kind: "boolean", value: isEquality ? matches : !matches };
      }
    }
  }

  // Handle `valueType === null` / `!== null` / `=== undefined` on a value type.
  // `T | null` erases to a value type (vector/map/set/struct), which is never
  // null in C++, so comparing it to nullptr is invalid (`no match for
  // operator==`). Resolve to a compile-time boolean. Demo #9 Finding D.
  //
  // A value type here is any non-pointer C++ type: the STL containers, strings,
  // and — critically — *interface names*, because an `interface Foo` lowers to
  // a C++ `struct Foo` (a value), not a pointer. Classes are always reference
  // types (pointers), so they are excluded by the `!parsedIsPointer(vt)` filter
  // (and by not being in topLevelInterfaceNames). Demo #18 Finding A: a struct
  // returned from a function/method and stored in a local (`let s: Account |
  // null = find(); s === null`) is now recognised as a value type and lowers to
  // a compile-time `false` instead of the invalid `s == CUTTLEFISH_UNDEFINED`.
  if (ts.isBinaryExpression(expr)
    && (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
    const isNullRhs = expr.right.kind === ts.SyntaxKind.NullKeyword || expr.right.kind === ts.SyntaxKind.UndefinedKeyword;
    const isNullLhs = expr.left.kind === ts.SyntaxKind.NullKeyword || expr.left.kind === ts.SyntaxKind.UndefinedKeyword;
    if (isNullRhs || isNullLhs) {
      const valueNode = isNullRhs ? expr.left : expr.right;
      // Resolve the operand's C++ type. Identifiers read it from the active
      // local/global type maps; an inline call (`findAccount(1) === null` or
      // `this.find(1) === null`) is resolved from the callee's declared return
      // type — see resolveCallReturnTypeForNullGuard below.
      let vt: string | undefined;
      if (ts.isIdentifier(valueNode)) {
        vt = getCurrentIrTypeScope()?.locals.get(valueNode.text) ?? getCurrentIrTypeScope()?.globals.get(valueNode.text);
      } else if (ts.isCallExpression(valueNode)) {
        vt = resolveCallReturnTypeForNullGuard(valueNode, sourceText);
      } else if (ts.isParenthesizedExpression(valueNode) || ts.isNonNullExpression(valueNode)) {
        const inner = ts.isParenthesizedExpression(valueNode) ? valueNode.expression : valueNode.expression;
        if (ts.isIdentifier(inner)) {
          vt = getCurrentIrTypeScope()?.locals.get(inner.text) ?? getCurrentIrTypeScope()?.globals.get(inner.text);
        } else if (ts.isCallExpression(inner)) {
          vt = resolveCallReturnTypeForNullGuard(inner, sourceText);
        }
      }
      // A "value type" for null-comparison purposes: a container, std::string,
      // or a value-typed interface/class name. Pointers are excluded (they
      // compare against nullptr, not {}).
      const isValueType = vt && !parsedIsPointer(vt) && (
        parsedIsVector(vt)
        || parsedIsMap(vt)
        || parsedIsSet(vt)
        || parsedIsStdString(vt)
        || topLevelInterfaceNames.has(parsedBareString(vt))
        || topLevelClassNames.has(parsedBareString(vt))
      );
      if (isValueType) {
        const isEquality = expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
        // A value type is never null → `=== null` is false, `!== null` is true.
        return { kind: "boolean", value: isEquality ? false : true };
      }
    }
  }
  // Standalone typeof x emits a type-name string literal.
  if (ts.isTypeOfExpression(expr)) {
    const operand = expr.expression;
    if (ts.isIdentifier(operand)) {
      const varType = getCurrentIrTypeScope()?.locals.get(operand.text) ?? getCurrentIrTypeScope()?.globals.get(operand.text);
      // The cuttlefish intNN_t/uintNN_t family maps to TS `number`.
      const isNumberType = varType === "int" || varType === "float" || varType === "double"
        || varType === "long" || varType === "long long" || varType === "unsigned long long"
        || varType === "unsigned" || varType === "size_t"
        || (varType !== undefined && /^(int|uint)(8|16|32|64)_t$/.test(varType));
      const typeName = isNumberType
        ? "number"
        : varType === "bool"
          ? "boolean"
          : varType === "std::string"
            ? "string"
            : varType === "void"
              ? "undefined"
              : "object";
      return { kind: "string", value: typeName };
    }
    if (ts.isNumericLiteral(operand)) return { kind: "string", value: "number" };
    if (ts.isStringLiteral(operand) || ts.isNoSubstitutionTemplateLiteral(operand)) return { kind: "string", value: "string" };
    if (operand.kind === ts.SyntaxKind.TrueKeyword || operand.kind === ts.SyntaxKind.FalseKeyword) return { kind: "string", value: "boolean" };
    if (ts.isArrayLiteralExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isObjectLiteralExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isFunctionExpression(operand) || ts.isArrowFunction(operand)) return { kind: "string", value: "function" };
    if (ts.isNewExpression(operand)) return { kind: "string", value: "object" };
    if (ts.isPropertyAccessExpression(operand)) {
      if (operand.name.text === "length") return { kind: "string", value: "number" };
      return { kind: "string", value: "object" };
    }
    if (ts.isCallExpression(operand) && ts.isPropertyAccessExpression(operand.expression)) {
      const methodName = operand.expression.name.text;
      if (["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "concat", "slice", "filter", "map", "reduce", "find", "findIndex", "every", "some", "forEach", "includes", "indexOf", "lastIndexOf", "join"].includes(methodName)) {
        return { kind: "string", value: "object" };
      }
    }
    return { kind: "string", value: "object" };
  }

  // Recurse into binary expressions so nested TypeCAD calls are translated correctly.
  if (ts.isBinaryExpression(expr)) {
    let operator = ts.tokenToString(expr.operatorToken.kind) ?? expr.operatorToken.getText();
    if (operator === "===") operator = "==";
    else if (operator === "!==") operator = "!=";
    return {
      kind: "binary",
      left: expressionToIR(expr.left, sourceText, diagnostics, pointerVars),
      operator,
      right: expressionToIR(expr.right, sourceText, diagnostics, pointerVars),
    };
  }

  // Preserve parenthesized expressions as a `paren` IR node so that explicit
  // grouping from the TS source is retained in the emitted C++ (e.g. `(2+3)*4`).
  if (ts.isParenthesizedExpression(expr)) {
    return { kind: "paren", inner: expressionToIR(expr.expression, sourceText, diagnostics, pointerVars) };
  }

  // Recurse into prefix unary so nested calls are translated correctly.
  if (ts.isPrefixUnaryExpression(expr)) {
    const operator = ts.tokenToString(expr.operator) ?? "";
    return {
      kind: "unary",
      operator,
      operand: expressionToIR(expr.operand, sourceText, diagnostics, pointerVars),
    };
  }

  // Handle postfix unary (i++, i--) so they compose correctly in IR.
  if (ts.isPostfixUnaryExpression(expr)) {
    const operator = ts.tokenToString(expr.operator) ?? "";
    return {
      kind: "unary",
      operator,
      operand: expressionToIR(expr.operand, sourceText, diagnostics, pointerVars),
      postfix: true,
    };
  }

  if (ts.isCallExpression(expr)) {
    // ---- console.* is not a supported API (value position) ----
    // Statement-position console calls are rejected in callToStatement; this
    // covers value-position uses (e.g. `const line = console.readLine()`).
    // Same rationale: the TypeScript console carry-over is gone — programs
    // write to a serial console explicitly via the board module.
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.expression) &&
      expr.expression.expression.text === "console"
    ) {
      diagnostics.push(makeDiagnostic(
        sourceText,
        expr.pos,
        `console.${expr.expression.name.text}() is not supported — write to a serial console instead: \`USB0.writeLine(...)\` (USB CDC) or \`UART0.writeLine(...)\` from the board module.`,
        "error",
        "console-unsupported",
      ));
      return { kind: "raw", value: "0 /* console.* is not supported */" };
    }

    // ---- safe.read/safe.write chained with .ok/.fail/.fault/.always ----
    // Method chains like `safe.read(pin).ok(r => {...}).fail(r => {...})` cannot
    // use the generic method-call builder because it flattens the receiver into
    // a callee STRING (expression-to-ir.ts ~line 1475), destroying inner lambda
    // args (they become `/* __lambda__ */` placeholders baked into the callee
    // text). This resolver detects a safe.* call followed by a chain of fluent
    // result methods and builds it bottom-up as nested method-call nodes with a
    // STRUCTURED receiverExpr, so the emit pipeline renders each lambda arg
    // inline via renderLambda (preserving closure captures).
    const safetyChain = tryResolveSafetyChain(expr, sourceText, diagnostics, pointerVars);
    if (safetyChain) return safetyChain;

    // ---- rawCppExpr() — compile-time C++ injection in expression context ----
    // Mirrors the statement-position rawCpp()/__EMIT__ path, but emits the raw
    // text as an expression (e.g. for IDF macros like WIFI_INIT_CONFIG_DEFAULT()
    // that produce struct values). The type parameter is a TS hint only — the
    // transpiler emits the raw text verbatim.
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "rawCppExpr") {
      const arg = expr.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        return { kind: "raw", value: arg.text };
      }
      if (arg && ts.isNoSubstitutionTemplateLiteral(arg)) {
        return { kind: "raw", value: arg.text };
      }
    }
    // ---- board() / boardResolve() — compile-time board constant lookup ----
    if (ts.isIdentifier(expr.expression) && (expr.expression.text === "board" || expr.expression.text === "boardResolve")) {
      const pathArg = expr.arguments[0];
      if (pathArg && ts.isStringLiteral(pathArg)) {
        const bc = getCurrentBoardConstants();
        if (bc) {
          const val = bc.get(pathArg.text);
          if (val !== undefined) {
            // Preserve the value's type: string board constants (e.g.
            // "architecture" → "avr") must render as C++ string literals, not
            // be coerced via Number() which yields NaN.
            if (typeof val === "string") return { kind: "string", value: val };
            return { kind: "number", value: Number(val) };
          }
        }
      }
      // Unresolved — emit 0 so the value is at least syntactically valid
      return { kind: "number", value: 0 };
    }

    // ---- HAL inline evaluator for expression context ----
    const halResult = tryResolveHALExpression(expr, sourceText, diagnostics, pointerVars);
    if (halResult) return halResult.ir;

    // ---- UI signal read: temp() → temp (the device variable) ----
    // A signal lowers to a plain variable, so calling it (the Signal<T>()
    // accessor) is just a read of that variable.
    if (
      ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 &&
      isSignalName(expr.expression.text)
    ) {
      return { kind: "identifier", value: expr.expression.text };
    }

    // ---- UI element .value read: screen.led.value → __ui_nodes[N].value ----
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "value" &&
      ts.isPropertyAccessExpression(expr.expression.expression) &&
      ts.isIdentifier(expr.expression.expression.expression)
    ) {
      const treeName = expr.expression.expression.expression.text;
      const elemId = expr.expression.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        return { kind: "raw", value: `__ui_nodes[${nodeIdx}].value` };
      }
    }

    // ---- UI element .text read: screen.ssid.text → __ui_nodes[N].textBuffer ----
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "text" &&
      ts.isPropertyAccessExpression(expr.expression.expression) &&
      ts.isIdentifier(expr.expression.expression.expression)
    ) {
      const treeName = expr.expression.expression.expression.text;
      const elemId = expr.expression.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        return { kind: "raw", value: `__ui_nodes[${nodeIdx}].textBuffer` };
      }
    }

    // Warn about optional chaining on call expressions â€” we preserve a null guard,
    // but the runtime semantics are still only approximate compared to TypeScript.
    if (isOptionalChainNode(expr)) {
      diagnostics.push(makeDiagnostic(
        sourceText, expr.pos,
        "Optional chaining (?.) is lowered with an approximate null guard in C++; semantics may differ from TypeScript.",
        "warning", "TS2CPP_OPTIONAL_CHAINING"
      ));
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const argsText = expr.arguments
          .map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)))
          .join(", ");
        const calleeText = renderMemberAccessText(expr.expression.expression, expr.expression.name.text);
        return {
          kind: "raw",
          value: renderOptionalGuardedAccess(expr.expression.expression, `${calleeText}(${argsText})`),
        };
      }
      // Bare-identifier optional call: `fn?.()`. Without this branch the call
      // falls through to the generic path and emits `fn()` unconditionally —
      // calling an empty std::function throws std::bad_function_call. Wrap the
      // call in the same null guard as the property-access case.
      if (ts.isIdentifier(expr.expression)) {
        const argsText = expr.arguments
          .map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)))
          .join(", ");
        const calleeText = expr.expression.text;
        return {
          kind: "raw",
          value: renderOptionalGuardedAccess(expr.expression, `${calleeText}(${argsText})`),
        };
      }
    }
    // ---- Pin factory constant-folding ---------------------------------------
    // createDigitalPin(pin, gpio), createPWMPin(pin, gpio), etc. are folded to
    // just the pin number (first argument) at compile time.
    if (ts.isIdentifier(expr.expression) && PIN_FACTORY_FUNCTIONS.has(expr.expression.text)) {
      if (expr.arguments.length >= 1 && ts.isNumericLiteral(expr.arguments[0])) {
        return { kind: "number", value: Number(expr.arguments[0].text) };
      }
    }

    // ---- Helper function constant-folding -----------------------------------
    // pinNumber(n) is folded to just the number value at compile time.
    if (ts.isIdentifier(expr.expression) && CONSTANT_FOLD_FUNCTIONS.has(expr.expression.text)) {
      if (expr.arguments.length >= 1 && ts.isNumericLiteral(expr.arguments[0])) {
        return { kind: "number", value: Number(expr.arguments[0].text) };
      }
      // Also handle nested expressions like pinNumber(someVar)
      if (expr.arguments.length >= 1) {
        return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
      }
    }

    const arrayMethodRes = tryLowerArrayAndStringMethods(expr, sourceText, diagnostics, pointerVars);
    if (arrayMethodRes !== null) {
      return arrayMethodRes;
    }

    if (ts.isPropertyAccessExpression(expr.expression) && ALL_STRING_METHODS.has(expr.expression.name.text)) {
      const receiver = expr.expression.expression;
      const isStringLiteralReceiver = ts.isStringLiteral(receiver) || ts.isNoSubstitutionTemplateLiteral(receiver);
      const isTemplateExprReceiver = ts.isTemplateExpression(receiver);
      const isStringVarReceiver = ts.isIdentifier(receiver) && (activeStringVars.has(receiver.text) || getCurrentIrTypeScope()?.locals.get(receiver.text) === "std::string");
      if (isStringLiteralReceiver || isTemplateExprReceiver || isStringVarReceiver) {
        const receiverIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
        let receiverText = renderExprAsText(receiverIR);
        if (receiver.kind === ts.SyntaxKind.StringLiteral || receiver.kind === (ts.SyntaxKind as any).NoSubstitutionTemplateLiteral) {
          receiverText = `std::string(${receiverText})`;
        }
        const methodName = expr.expression.name.text;
        const argsText = expr.arguments.map(a => renderExprAsText(expressionToIR(a, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${receiverText}.${methodName}(${argsText})` };
      }
    }

    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Error") {
      const message = expr.arguments.length > 0
        ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
        : '"error"';
      return { kind: "raw", value: `std::runtime_error(${message})` };
    }

    if (ts.isIdentifier(expr.expression)) {
      const fnName = expr.expression.text;
      if (fnName === "parseInt" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        // atoi/atof take const char*; the arg is typically a std::string.
        // Use .c_str() so the conversion compiles.
        return { kind: "raw", value: `atoi((${argText}).c_str())` };
      }
      if (fnName === "parseFloat" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `atof((${argText}).c_str())` };
      }
      if (fnName === "isNaN" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `std::isnan(${argText})` };
      }
      if (fnName === "isFinite" && expr.arguments.length >= 1) {
        const argText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `std::isfinite(${argText})` };
      }
      if (fnName === "Number" && expr.arguments.length >= 1) {
        return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
      }
      if (fnName === "String" && expr.arguments.length >= 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        return { kind: "template_string", expression: argIR };
      }
      if (fnName === "Boolean" && expr.arguments.length >= 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        return { kind: "raw", value: `static_cast<bool>(${renderExprAsText(argIR)})` };
      }
    }

    // Handle static method calls on built-in objects: Array.isArray, Object.keys/values/entries/assign
    if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression)) {
      const objName = expr.expression.expression.text;
      const methodName = expr.expression.name.text;

      if (objName === "Array" && methodName === "isArray" && expr.arguments.length === 1) {
        const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
        const argText = renderExprAsText(argIR);
        let argType: string | undefined;
        if (ts.isIdentifier(expr.arguments[0])) {
          argType = getCurrentIrTypeScope()?.locals.get(expr.arguments[0].text) ?? getCurrentIrTypeScope()?.globals.get(expr.arguments[0].text);
        }
        if (argType && parsedIsVector(argType)) {
          return { kind: "boolean", value: true };
        }
        return { kind: "boolean", value: false };
      }

      if (objName === "Object" && expr.arguments.length >= 1) {
        const argNode = expr.arguments[0];
        const argIR = expressionToIR(argNode, sourceText, diagnostics, pointerVars);
        const argText = renderExprAsText(argIR);
        let argType: string | undefined;
        if (ts.isIdentifier(argNode)) {
          argType = getCurrentIrTypeScope()?.locals.get(argNode.text) ?? getCurrentIrTypeScope()?.globals.get(argNode.text);
        } else if (ts.isPropertyAccessExpression(argNode) && argNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
          // `Object.keys(this.field)` — resolve the field's type via the
          // this->field map populated during class IR build.
          argType = getCurrentIrTypeScope()?.locals.get(`this->${argNode.name.text}`);
          if (!argType) {
            argType = getCurrentIrTypeScope()?.classFields.get(`this->${argNode.name.text}`);
          }
        }

        if (methodName === "keys") {
          if (argType && parsedIsMap(argType)) {
            return { kind: "raw", value: `__tc_mapKeys(${argText})` };
          }
          if (ts.isObjectLiteralExpression(argNode)) {
            const fieldNames = argNode.properties
              .filter(ts.isPropertyAssignment)
              .filter(p => ts.isIdentifier(p.name))
              .map(p => (p.name as ts.Identifier).text);
            return { kind: "array", elementType: "const char*", elements: fieldNames.map(n => ({ kind: "string" as const, value: n })) };
          }
          return emitUnsupportedExpression("Object.keys on non-map types is unsupported.");
        }
        if (methodName === "values") {
          if (argType && parsedIsMap(argType)) {
            return { kind: "raw", value: `__tc_mapValues(${argText})` };
          }
          if (ts.isObjectLiteralExpression(argNode)) {
            const elements = argNode.properties
              .filter(ts.isPropertyAssignment)
              .map(p => expressionToIR(p.initializer, sourceText, diagnostics, pointerVars));
            return { kind: "array", elementType: "auto", elements };
          }
          return emitUnsupportedExpression("Object.values on non-map types is unsupported.");
        }
        if (methodName === "entries") {
          if (argType && parsedIsMap(argType)) {
            return { kind: "raw", value: `__tc_mapEntries(${argText})` };
          }
          return emitUnsupportedExpression("Object.entries on non-map types is unsupported.");
        }
        if (methodName === "assign" && expr.arguments.length === 2) {
          const targetText = argText;
          const srcIR = expressionToIR(expr.arguments[1], sourceText, diagnostics, pointerVars);
          const srcText = renderExprAsText(srcIR);
          return { kind: "raw", value: `(${targetText} = ${srcText})` };
        }
        if (methodName === "fromEntries" && expr.arguments.length === 1) {
          const entriesNode = expr.arguments[0];
          const entriesIR = expressionToIR(entriesNode, sourceText, diagnostics, pointerVars);
          const entriesText = renderExprAsText(entriesIR);
          return { kind: "raw", value: `__tc_fromEntries(${entriesText})` };
        }
      }

      if (objName === "JSON") {
        if (methodName === "stringify" && expr.arguments.length >= 1) {
          const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
          const argText = renderExprAsText(argIR);
          return { kind: "raw", value: `__tc_jsonStringify(${argText})` };
        }
        if (methodName === "parse" && expr.arguments.length >= 1) {
          const argIR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
          const argText = renderExprAsText(argIR);
          return { kind: "raw", value: `__tc_jsonParse(${argText})` };
        }
      }
    }

    if (ts.isIdentifier(expr.expression) && expr.expression.text === "defineBoardManifest" && expr.arguments.length === 1) {
      return expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
    }

    // Handle method calls like this.method() or obj.method()
    // Use -> for pointer variables (from 'new') and for 'this', . for value types
    let calleeText: string;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const receiver = expr.expression.expression;
      const rawMethodName = expr.expression.name.kind === ts.SyntaxKind.PrivateIdentifier
        ? `__priv_${expr.expression.name.text.substring(1)}`
        : expr.expression.name.text;
      // NOTE: do NOT escapeCppKeyword before the Map/Set method checks below —
      // `m.delete(k)` would become `methodName === "delete_"` and miss the
      // map→erase lowering (demo #8 Finding D). Escape only when building the
      // final callee text for the generic path.
      const methodName = rawMethodName;

      // --- .toFixed(digits) on numeric values ---
      if (methodName === "toFixed" && expr.arguments.length >= 1) {
        const receiverIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
        const digitsArg = expr.arguments[0];
        let digits: number;
        if (ts.isNumericLiteral(digitsArg)) {
          digits = parseInt(digitsArg.text, 10);
        } else {
          const digitsIR = expressionToIR(digitsArg, sourceText, diagnostics, pointerVars);
          if (digitsIR.kind === "number" && Number.isInteger(digitsIR.value)) {
            digits = digitsIR.value;
          } else {
            digits = 0;
          }
        }
        const receiverText = renderExprAsText(receiverIR);
        return { kind: "raw", value: `__tc_toFixed(${receiverText}, ${digits})` };
      }

      // --- Map/Set iteration methods: .values() / .keys() / .entries() ---
      // These lower to the same __tc_mapValues/__tc_mapKeys/__tc_mapEntries
      // helpers used for Object.values(map) etc. (defined in the native
      // strategy). They return std::vector<V/K/pair>, so a downstream
      // for...of iterates the values/keys/pairs correctly — NOT the raw
      // std::pair entries of the underlying std::map (demo #15 fix A).
      if ((methodName === "values" || methodName === "keys" || methodName === "entries") && expr.arguments.length === 0) {
        let receiverType: string | undefined;
        if (ts.isIdentifier(receiver)) {
          receiverType = getCurrentIrTypeScope()?.locals.get(receiver.text) ?? getCurrentIrTypeScope()?.globals.get(receiver.text);
        } else if (ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
          receiverType = getCurrentIrTypeScope()?.locals.get(`this->${receiver.name.text}`);
        }
        if (receiverType && (parsedIsMap(receiverType) || parsedIsSet(receiverType))) {
          const recIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
          const recText = renderExprAsText(recIR);
          // Set.values()/keys() both yield the elements; entries() yields
          // pair<elem,elem>. Map.values()/keys()/entries() are as expected.
          const isSet = parsedIsSet(receiverType);
          const helper = methodName === "values"
            ? (isSet ? "__tc_setValues" : "__tc_mapValues")
            : methodName === "keys"
              ? (isSet ? "__tc_setValues" : "__tc_mapKeys")
              : (isSet ? "__tc_setEntries" : "__tc_mapEntries");
          return { kind: "raw", value: `${helper}(${recText})` };
        }
      }

      // --- Map/Set method lowering ---
      if ((methodName === "set" || methodName === "get" || methodName === "has" || methodName === "delete" || methodName === "add") && expr.arguments.length >= 1) {
        let receiverType: string | undefined;
        let receiverText: string | undefined;

        if (ts.isIdentifier(receiver)) {
          receiverType = getCurrentIrTypeScope()?.locals.get(receiver.text) ?? getCurrentIrTypeScope()?.globals.get(receiver.text);
        } else if (ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
          receiverType = getCurrentIrTypeScope()?.locals.get(`this->${receiver.name.text}`);
        }

        if (receiverType && (parsedIsMap(receiverType) || parsedIsSet(receiverType))) {
          const recIR = expressionToIR(receiver, sourceText, diagnostics, pointerVars);
          receiverText = renderExprAsText(recIR);
          const arg0IR = expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars);
          let arg0Text = renderExprAsText(arg0IR);
          // When the key is an enum-typed operand and the container's key type
          // is integral, wrap it in static_cast so it matches the comparator /
          // converts the enum class to the integral key. Handles BOTH shapes:
          //   - an enum member access (Color.Red) — detected via activeEnumNames; and
          //   - a bare identifier whose declared type is an enum (k where k: K)
          //     — resolved through the in-scope IR type map. Demo #28 Finding E
          //     review: previously only the enum-member shape was cast, so a
          //     bare enum-typed key variable on .has/.get/.delete (expression
          //     form) compiled to an uncast map.count(k)/map.at(k) and failed.
          const receiverIr = parseCppType(receiverType);
          const mapKeyType = receiverIr.kind === "map" ? renderCppType(receiverIr.key) : "";
          const keyIsIntegral = /^(int|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|size_t|long|short|unsigned|char)$/.test(mapKeyType);
          let keyIsEnum = false;
          if (keyIsIntegral) {
            const keyArg = expr.arguments[0];
            if (ts.isPropertyAccessExpression(keyArg) && ts.isIdentifier(keyArg.expression)) {
              keyIsEnum = activeEnumNames.has(keyArg.expression.text);
            } else if (ts.isIdentifier(keyArg)) {
              const keyVarType = getCurrentIrTypeScope()?.locals.get(keyArg.text) ?? getCurrentIrTypeScope()?.globals.get(keyArg.text);
              if (keyVarType && activeEnumNames.has(keyVarType)) {
                keyIsEnum = true;
              }
            }
          }
          if (keyIsEnum) {
            arg0Text = `static_cast<${mapKeyType}>(${arg0Text})`;
          }

          if (parsedIsMap(receiverType)) {
            if (methodName === "set" && expr.arguments.length >= 2) {
              const arg1IR = expressionToIR(expr.arguments[1], sourceText, diagnostics, pointerVars);
              const arg1Text = renderExprAsText(arg1IR);
              return { kind: "raw", value: `(${receiverText}[${arg0Text}] = ${arg1Text})` };
            }
            if (methodName === "get") {
              // Use .at() (const-correct, throws on miss) rather than operator[]
              // (non-const, fails on a const-bound Map, silently inserts on miss).
              // The idiomatic m.get(k)! asserts presence, matching .at() contract. (demo #15 fix B)
              return { kind: "raw", value: `${receiverText}.at(${arg0Text})` };
            }
            if (methodName === "has") {
              return { kind: "raw", value: `(${receiverText}.count(${arg0Text}) > 0)` };
            }
            if (methodName === "delete") {
              return { kind: "raw", value: `(${receiverText}.erase(${arg0Text}) > 0)` };
            }
          }
          if (parsedIsSet(receiverType)) {
            if (methodName === "add") {
              return { kind: "raw", value: `${receiverText}.insert(${arg0Text})` };
            }
            if (methodName === "has") {
              return { kind: "raw", value: `(${receiverText}.count(${arg0Text}) > 0)` };
            }
            if (methodName === "delete") {
              return { kind: "raw", value: `(${receiverText}.erase(${arg0Text}) > 0)` };
            }
          }
        }
      }

      // Check if it's a this.method() call - in C++, this is a pointer so use ->
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        calleeText = `this->${escapeCppKeyword(methodName)}`;
      } else if (ts.isIdentifier(receiver) && receiver.text === "Math") {
        const mathMethod = expr.expression.name.text;
        if (mathMethod === "random") {
          calleeText = "__tc_random";
        } else if ((mathMethod === "max" || mathMethod === "min") && expr.arguments && expr.arguments.length >= 1) {
          const op = mathMethod === "max" ? ">" : "<";
          const args = expr.arguments.map(a => expressionToIR(a, sourceText, diagnostics, pointerVars));
          let result = args[0];
          for (let i = 1; i < args.length; i++) {
            result = {
              kind: "ternary",
              condition: { kind: "binary", left: result, operator: op, right: args[i] } as ExpressionIR,
              whenTrue: result,
              whenFalse: args[i],
            };
          }
          return result;
        } else {
          calleeText = `std::${mathMethod}`;
        }
      } else if (ts.isIdentifier(receiver) && (hoistedNestedClasses.some(c => c.name === receiver.text) || nestedClassAliases.has(receiver.text) || topLevelClassNames.has(receiver.text))) {
        // Static method call on a hoisted or top-level class: use :: with resolved name
        const resolvedName = nestedClassAliases.get(receiver.text) ?? receiver.text;
        calleeText = `${resolvedName}::${methodName}`;
      } else if (ts.isIdentifier(receiver) && activeNamespaceNames.has(receiver.text)) {
        // Namespace method call: use ::
        calleeText = `${receiver.text}::${methodName}`;
      } else {
        const objText = renderExprAsText(expressionToIR(receiver, sourceText, diagnostics, pointerVars));
        let accessor = ".";
        if (ts.isIdentifier(receiver) && (pointerVars.has(receiver.text) || parsedIsPointer(getCurrentIrTypeScope()?.locals.get(receiver.text) ?? "") || parsedIsPointer(getCurrentIrTypeScope()?.globals.get(receiver.text) ?? ""))) {
          accessor = "->";
        } else if (ts.isPropertyAccessExpression(receiver)
                   && receiver.expression.kind === ts.SyntaxKind.ThisKeyword
                   && ts.isIdentifier(receiver.name)) {
          const fieldType = getCurrentIrTypeScope()?.locals.get(`this->${receiver.name.text}`);
          if (fieldType && parsedIsPointer(fieldType)) {
            accessor = "->";
          }
        } else if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
          const innerReceiver = receiver.expression.expression;
          const innerMethodName = receiver.expression.name.text;
          if (ts.isIdentifier(innerReceiver) && pointerVars.has(innerReceiver.text)) {
            // Check if the inner method returns a pointer type (for method chaining)
            let className = pointerVars.get(innerReceiver.text);
            // Resolve nested class aliases (e.g., "Builder" → "__tc_fn6__Builder")
            if (className) className = nestedClassAliases.get(className) ?? className;
            const cls = className ? hoistedNestedClasses.find(c => c.name === className) : undefined;
            const chainMethod = cls?.methods.find(m => m.name === innerMethodName);
            if (chainMethod && parsedIsPointer(chainMethod.returnType as string)) {
              accessor = "->";
            }
          } else if (ts.isIdentifier(innerReceiver) && topLevelClassNames.has(innerReceiver.text)) {
            // Static method call on a top-level class returning a pointer
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
        }
        if (accessor === ".") {
          const receiverType = resolveExprCppType(receiver);
          if (receiverType && parsedIsPointer(receiverType)) {
            accessor = "->";
          }
        }
        calleeText = `${objText}${accessor}${escapeCppKeyword(methodName)}`;
      }
    } else {
      const rawText = expr.expression.getText();
      calleeText = nestedFunctionAliases.get(rawText) ?? rawText;
    }
    const argIRs: ExpressionIR[] = [];
    for (const arg of expr.arguments) {
      if (ts.isSpreadElement(arg)) {
        // Spreading into a call. Cuttlefish lowers every rest parameter
        // (`...args: T[]`) to a SINGLE `const std::vector<T>&` parameter, so a
        // spread of a vector variable (`sum(...arr)`) must pass the vector
        // directly — NOT `arr.begin(), arr.end()` (which passes two iterators
        // to one vector param and fails g++). For a non-vector spread we pass
        // the rendered expression as-is. See demo #6 fix E.
        argIRs.push(expressionToIR(arg.expression, sourceText, diagnostics, pointerVars));
      } else {
        argIRs.push(expressionToIR(arg, sourceText, diagnostics, pointerVars));
      }
    }
    
    let isStatic = false;
    let isNamespace = false;
    if (ts.isPropertyAccessExpression(expr.expression)) {
      let root: ts.Expression = expr.expression;
      while (ts.isPropertyAccessExpression(root)) {
        root = root.expression;
      }
      if (ts.isIdentifier(root)) {
        const name = root.text;
        if (activeNamespaceNames.has(name)) {
          isNamespace = true;
        } else if (topLevelClassNames.has(name) || nestedClassAliases.has(name) || name === "Math") {
          isStatic = true;
        }
      }
    }

    return {
      kind: "method-call",
      callee: calleeText,
      args: argIRs,
      isStatic,
      isNamespace,
      // isPointer when the callee text already uses ->, OR when the receiver
      // resolves to a pointer type. The receiver is the object the method is
      // called on: for `a.b.c()` it is `a.b`. resolveExprCppType walks
      // class/interface fields to find the receiver's C++ type; if it ends
      // with '*' (a class-pointer struct field, e.g. FloorState.monster), the
      // method call must use ->. Without this, `dungeon.monster.bounty()`
      // emits `.` and fails g++ ("request for member 'bounty' ... pointer
      // type"). (demo #4 fix.)
      isPointer: calleeText.includes("->")
        || (ts.isCallExpression(expr)
          && ts.isPropertyAccessExpression(expr.expression)
          && (() => {
            const receiverType = resolveExprCppType(expr.expression.expression);
            return !!receiverType && parsedIsPointer(receiverType);
          })()),
      restElementType: restParamFunctions.get(calleeText),
      cppType: resolveExprCppType(expr),
    };
  }

  if (ts.isNewExpression(expr)) {
    let ctorText = formatExpressionText(expr.expression);
    // Base ctor name without type arguments — used for the Map/Set checks
    // below, which must fire even when the user wrote `new Map<K, V>()`.
    const baseCtorName = ctorText;
    if (expr.typeArguments && expr.typeArguments.length > 0) {
      // Resolve type args through typeNodeToCppType so `new Registry<string, int32_t>()`
      // emits `Registry<std::string, int32_t>` (TS type names → C++ type names)
      // rather than the raw source text or dropping the args entirely.
      const typeArgs = expr.typeArguments.map((ta: ts.TypeNode) => typeNodeToCppType(ta, undefined)).join(", ");
      ctorText = `${ctorText}<${typeArgs}>`;
    }

    // Special case: new TypedArray([...]) â†’ C++ array initializer
    const elementType = TYPED_ARRAY_ELEMENT_MAP[ctorText];
    if (elementType) {
      const args = expr.arguments ?? [];
      if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
        const elements = args[0].elements.map(e =>
          expressionToIR(e, sourceText, diagnostics, pointerVars)
        );
        return { kind: "array", elements, elementType } as any;
      }
      // new TypedArray(n) â€” allocate n elements (zero-initialized)
      if (args.length === 1) {
        const sizeIR = expressionToIR(args[0], sourceText, diagnostics, pointerVars);
        const size = renderExprAsText(sizeIR);
        const count = parseInt(size, 10);
        if (!isNaN(count) && count > 0 && count <= 256) {
          // Return array IR with zero elements so var_decl renderer emits proper C array
          const zeros = Array(count).fill(0).map(() => ({ kind: "number" as const, value: 0 }));
          return { kind: "array", elements: zeros, elementType } as any;
        }
        // Dynamic size fallback â€” emit as raw (may not compile in all contexts)
        return { kind: "raw", value: `{${elementType}(${size})}` };
      }
    }

    const argsText = (expr.arguments ?? [])
      .map((arg) => {
        if (ts.isObjectLiteralExpression(arg)) {
          const fields: string[] = [];
          for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop)) {
              const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
              const val = renderExprAsText(expressionToIR(prop.initializer, sourceText, diagnostics, pointerVars));
              fields.push(`.${name} = ${val}`);
            }
          }
          return fields.length > 0 ? `{ ${fields.join(", ")} }` : "0";
        }
        return renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars));
      })
      .join(", ");

    if (ctorText === "Error") {
      const message = expr.arguments && expr.arguments.length > 0
        ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
        : '"error"';
      return { kind: "raw", value: `std::runtime_error(${message})` };
    }

    if (baseCtorName === "Map") {
      // Demo #30 Finding E — `new Map()` lowers to `{}` (an empty
      // std::map), but `new Map([[k, v], ...])` (the idiomatic TS
      // constructor-with-initial-entries form) previously had its argument
      // DROPPED and also lowered to `{}`, so the map started empty. The fix:
      // when an initializer argument is present, render it into the
      // brace-init-list. `argsText` already renders a single array-literal
      // argument as `{ {k1, v1}, {k2, v2}, ... }` (renderExprAsText of an
      // array of arrays), which is exactly the `std::initializer_list<pair>`
      // form `std::map`'s constructor accepts. A non-iterable argument
      // (`new Map(otherMap)`) has no clean C++ equivalent and falls back to
      // `{}` — matching the prior behavior. This mirrors the Set fix below.
      if ((expr.arguments ?? []).length === 1) {
        return { kind: "raw", value: argsText };
      }
      return { kind: "raw", value: "{}" };
    }
    if (baseCtorName === "Set") {
      // Demo #30 Finding E — `new Set()` lowers to `{}` (an empty std::set),
      // but `new Set([a, b, c])` (the idiomatic TS constructor-with-initial-
      // elements form) previously had its argument DROPPED and also lowered to
      // `{}`, so the set started empty. The fix: when an initializer argument
      // is present, render it into the brace-init-list. `argsText` already
      // renders a single array-literal argument as `{ a, b, c }`
      // (renderExprAsText of an array), which is exactly the
      // `std::initializer_list<T>` form `std::set`'s constructor accepts. A
      // non-iterable argument (`new Set(otherSet)`) has no clean C++
      // equivalent and falls back to `{}` — matching the prior behavior.
      if ((expr.arguments ?? []).length === 1) {
        return { kind: "raw", value: argsText };
      }
      return { kind: "raw", value: "{}" };
    }

    // `new Array<E>(...)` — the idiomatic TS pre-sized/empty array constructor.
    // Demo #29 Finding B: this was previously emitted verbatim
    // (`new Array<uint32_t>(256)`) and failed at g++ time ("'Array' does not
    // name a type"), because the `Array` constructor — unlike `Array.from`/
    // `Array.of` (which are intentionally rejected) — had neither a lowering
    // nor a gate. The clean C++ equivalent is a `std::vector<E>`:
    //   `new Array<E>(n)`     → `std::vector<E>(n)`   (n value-initialized elems)
    //   `new Array<E>()`      → `std::vector<E>()`    (empty)
    //   `new Array<E>(a,b,c)` → `std::vector<E>{a,b,c}` (element list)
    // The element type comes from the type argument; without one we cannot
    // pick a C++ element type, so fall through to the unsupported-ctor path
    // (gated by feature-registry) rather than guess.
    if (baseCtorName === "Array" && expr.typeArguments && expr.typeArguments.length === 1) {
      const elemCpp = typeNodeToCppType(expr.typeArguments[0], undefined);
      const args = expr.arguments ?? [];
      if (args.length === 0) {
        return { kind: "raw", value: `std::vector<${elemCpp}>()` };
      }
      if (args.length === 1) {
        // Sized constructor: n value-initialized elements. The size argument
        // is rendered through the normal expression path.
        const sizeText = renderExprAsText(expressionToIR(args[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `std::vector<${elemCpp}>(${sizeText})` };
      }
      // Two+ args: treat as an element list (TS `new Array<E>(a, b, c)`).
      return { kind: "raw", value: `std::vector<${elemCpp}>{ ${argsText} }` };
    }

    const resolvedCtorText = nestedClassAliases.get(ctorText) ?? ctorText;
    // Tag the node with the constructed class name so the heap-allocation
    // validator can detect heap allocation by CONSTRUCT (demo #34 Finding A),
    // not by pattern-matching the `raw` text (whose presence depended on
    // unrelated import structure).
    return { kind: "raw", value: `new ${resolvedCtorText}(${argsText})`, newClassName: resolvedCtorText };
  }
  if (ts.isStringLiteral(expr)) {
    return { kind: "string", value: expr.text };
  }

  // Handle template literals without interpolation (simple strings)
  if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { kind: "string", value: expr.text };
  }

  // Handle template literals with interpolation - convert to string concatenation
  if (ts.isTemplateExpression(expr)) {
    // Build a string concatenation expression from the template literal
    const parts: ExpressionIR[] = [];
    
    // Add the head text (before first interpolation)
    if (expr.head.text) {
      parts.push({ kind: "string", value: expr.head.text });
    }
    
    // Add each template span (interpolation + trailing text)
    for (const span of expr.templateSpans) {
      // Add the interpolated expression (converted to string if needed)
      const exprIR = expressionToIR(span.expression, sourceText, diagnostics, pointerVars);
      // Wrap in a template_string conversion - the emitter will handle toString conversion
      parts.push({ kind: "template_string", expression: exprIR });
      
      // Add the trailing text
      if (span.literal.text) {
        parts.push({ kind: "string", value: span.literal.text });
      }
    }
    
    // If only one part, return it directly
    if (parts.length === 1) {
      return parts[0];
    }
    
    // Build concatenation chain
    return { kind: "string_concat", parts };
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: expr.kind === ts.SyntaxKind.TrueKeyword };
  }

  // Handle null keyword
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "identifier", value: "nullptr" };
  }

  if (expr.kind === ts.SyntaxKind.UndefinedKeyword) {
    return { kind: "identifier", value: "CUTTLEFISH_UNDEFINED" };
  }

  if (ts.isIdentifier(expr)) {
    // Resolve tracked HAL instances to their resolved values
    const halInst = halInstances.get(expr.text);
    if (halInst) {
      // For Pin instances, resolve to the pin number
      if (halInst.fieldValues.has("_pin")) {
        return { kind: "raw", value: halInst.fieldValues.get("_pin")! };
      }
    }
    // Apply nested-function-alias mangling so a `return dbl` reference to a
    // nested function declaration resolves to its hoisted mangled name
    // (makeScaler__dbl). Without this, the reference emits the bare name and
    // g++ reports "'dbl' was not declared in scope" (demo #9 Finding B).
    const nestedAlias = nestedFunctionAliases.get(expr.text);
    return { kind: "identifier", value: nestedAlias ?? expr.text };
  }

  // Handle 'this' keyword
  if (expr.kind === ts.SyntaxKind.ThisKeyword) {
    return { kind: "raw", value: "this" };
  }

  // Handle property access expressions like obj.property or this.field
  if (ts.isPropertyAccessExpression(expr)) {
    // ── Ambient canvas dims: ctx.width / ctx.height → __ui_canvas_w / _h ──
    {
      const canvasCtx = getCanvasAmbientCtx();
      if (
        canvasCtx &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === canvasCtx &&
        (expr.name.text === "width" || expr.name.text === "height")
      ) {
        return {
          kind: "identifier",
          value: expr.name.text === "width" ? "__ui_canvas_w" : "__ui_canvas_h",
        };
      }
    }
    // ── UI element .value read: screen.led.value → __ui_nodes[N].value ──
    if (expr.name.text === "value" &&
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression)) {
      const treeName = expr.expression.expression.text;
      const elemId = expr.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        return { kind: "raw", value: `__ui_nodes[${nodeIdx}].value` };
      }
    }
    // ── UI element .text read: screen.ssid.text → __ui_nodes[N].textBuffer ──
    if (expr.name.text === "text" &&
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression)) {
      const treeName = expr.expression.expression.text;
      const elemId = expr.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        return { kind: "raw", value: `__ui_nodes[${nodeIdx}].textBuffer` };
      }
    }
    const propName = expr.name.kind === ts.SyntaxKind.PrivateIdentifier
      ? `__priv_${expr.name.text.substring(1)}`
      : expr.name.text;
    if (isOptionalChainNode(expr)) {
      diagnostics.push(makeDiagnostic(
        sourceText, expr.pos,
        "Optional chaining (?.) is lowered with an approximate null guard in C++; semantics may differ from TypeScript.",
        "warning", "TS2CPP_OPTIONAL_CHAINING"
      ));
      const accessText = renderMemberAccessText(expr.expression, propName);
      return { kind: "raw", value: renderOptionalGuardedAccess(expr.expression, accessText) };
    }
    const regRead = tryLowerRegisterRead(expr, sourceText, diagnostics);
    if (regRead !== null) {
      return regRead;
    }

    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return { kind: "property-access", object: { kind: "raw", value: "this" }, property: propName };
    }
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "Math") {
      if (propName === "random") return { kind: "raw", value: "__tc_random()" };
      const mathConst = MATH_CONSTANT_LITERALS[propName];
      if (mathConst !== undefined) return { kind: "number", value: mathConst };
      return { kind: "raw", value: `std::${propName}` };
    }
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    if (propName === "length") {
      const objectText = renderExprAsText(object);
      const resolved = resolveLengthProperty(expr.expression, objectText);
      if (resolved.startsWith("__FILTERED_LEN__")) {
        return { kind: "identifier", value: resolved.slice("__FILTERED_LEN__".length) };
      }
      return { kind: "raw", value: resolved };
    }
    // `.size` on a Map/Set (std::map/std::set) — these expose size as a method
    // (`m.size()`), not a member. Map it to a method call so it doesn't fall
    // through to the pointer-deref property-access path (which would emit
    // `m->size` / `this->field.size`). Mirrors the `.length` → `.size()`
    // lowering for vectors.
    //
    // Demo #29 Finding C: this previously resolved the receiver type ONLY for a
    // bare identifier, so `this.field.size` / `obj.field.size` on a Map/Set
    // field fell through to the generic property-access path and emitted the
    // bare member `this->field.size` (g++: "has no member named 'size'"). The
    // `.length` path (resolveLengthProperty) was already extended to member
    // receivers in demos #22/#27; this closes the parallel `.size` gap. We now
    // resolve the receiver via the shared `resolveExprCppType`, which covers
    // bare identifiers, `this.field`, `obj.field`, and element access uniformly.
    if (propName === "size") {
      const receiverType = resolveExprCppType(expr.expression);
      if (receiverType && (parsedIsMap(receiverType) || parsedIsSet(receiverType))) {
        const objectText = renderExprAsText(object);
        return { kind: "raw", value: `static_cast<long long>(${objectText}.size())` };
      }
    }

    // Use -> for pointer variables in property access
    if (ts.isIdentifier(expr.expression) && (pointerVars.has(expr.expression.text) || parsedIsPointer(getCurrentIrTypeScope()?.locals.get(expr.expression.text) ?? "") || parsedIsPointer(getCurrentIrTypeScope()?.globals.get(expr.expression.text) ?? ""))) {
      return {
        kind: "property-access",
        object: { kind: "identifier", value: expr.expression.text },
        property: propName,
        isPointer: true
      };
    }

    // Use -> for this->pointerField in property access (e.g. this.player.name)
    if (ts.isPropertyAccessExpression(expr.expression)
        && expr.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && ts.isIdentifier(expr.expression.name)) {
      const fieldName = expr.expression.name.text;
      const fieldType = getCurrentIrTypeScope()?.locals.get(`this->${fieldName}`);
      if (fieldType && parsedIsPointer(fieldType)) {
        return {
          kind: "property-access",
          object: expressionToIR(expr.expression, sourceText, diagnostics, pointerVars),
          property: propName,
          isPointer: true,
        };
      }
    }

    // General deep chain: resolve receiver type, use -> if receiver is a pointer
    const receiverCppType = resolveExprCppType(expr.expression);
    if (receiverCppType && parsedIsPointer(receiverCppType)) {
      return {
        kind: "property-access",
        object,
        property: propName,
        isPointer: true,
      };
    }

    let isEnum = false;
    let isNamespace = false;
    let isStatic = false;

    if (ts.isIdentifier(expr.expression)) {
      const name = expr.expression.text;
      if (activeEnumNames.has(name)) {
        isEnum = true;
      } else if (activeNamespaceNames.has(name)) {
        isNamespace = true;
      } else if (topLevelClassNames.has(name) || nestedClassAliases.has(name)) {
        isStatic = true;
      }
    } else if (ts.isPropertyAccessExpression(expr.expression)) {
      let root: ts.Expression = expr.expression;
      while (ts.isPropertyAccessExpression(root)) {
        root = root.expression;
      }
      if (ts.isIdentifier(root) && activeNamespaceNames.has(root.text)) {
        isNamespace = true;
      }
    }

    let isPointer = false;
    if (ts.isIdentifier(expr.expression) && pointerVars.has(expr.expression.text)) {
      isPointer = true;
    } else if ((expr.expression.kind as number) === ts.SyntaxKind.ThisKeyword) {
      isPointer = true;
    }

    return { 
      kind: "property-access", 
      object, 
      property: propName,
      isEnum,
      isNamespace,
      isStatic,
      isPointer
    };
  }

  if (ts.isElementAccessExpression(expr)) {
    const object = expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
    const index = expressionToIR(expr.argumentExpression, sourceText, diagnostics, pointerVars);
    if (index.kind === "number" && Number.isInteger(index.value)) {
      let objectType: string | undefined;
      let elementType: string | undefined;
      if (ts.isIdentifier(expr.expression)) {
        objectType = getCurrentIrTypeScope()?.locals.get(expr.expression.text) ?? getCurrentIrTypeScope()?.globals.get(expr.expression.text);
        if (objectType) {
          elementType = parsedElementString(objectType);
        }
      } else if (ts.isPropertyAccessExpression(expr.expression)) {
        const receiverNode = expr.expression.expression;
        if (ts.isIdentifier(receiverNode)) {
          const receiverType = getCurrentIrTypeScope()?.locals.get(receiverNode.text) ?? getCurrentIrTypeScope()?.globals.get(receiverNode.text);
          if (receiverType) {
            const className = parsedBareString(receiverType);
            const classDef = topLevelClasses.get(className);
            if (classDef) {
              const fieldName = expr.expression.name.text;
              const field = classDef.fields.find((f) => f.name === fieldName);
              if (field) {
                objectType = field.cppType;
                elementType = parsedElementString(field.cppType);
              }
            }
          }
        }
      }
      if (typeof objectType === "string" && parsedIsTuple(objectType)) {
        return { kind: "tuple-access", object, index: index.value };
      }
      return { kind: "element-access", object, index, elementType };
    }
    return { kind: "element-access", object, index };
  }

  // Handle ternary/conditional expressions: a ? b : c
  if (ts.isConditionalExpression(expr)) {
    return {
      kind: "ternary",
      condition: expressionToIR(expr.condition, sourceText, diagnostics),
      whenTrue: expressionToIR(expr.whenTrue, sourceText, diagnostics),
      whenFalse: expressionToIR(expr.whenFalse, sourceText, diagnostics),
    };
  }

  // Handle array literals
  if (ts.isArrayLiteralExpression(expr)) {
    // Check for spread element in array
    const spreadIndex = expr.elements.findIndex(e => ts.isSpreadElement(e));

    if (spreadIndex !== -1) {
      // Handle spread in array: [...arr, x, y]
      const spreadElement = expr.elements[spreadIndex];
      if (ts.isSpreadElement(spreadElement)) {
        // If spread source is a known-size array variable, expand inline
        if (ts.isIdentifier(spreadElement.expression) && arrayLiteralSizes.has(spreadElement.expression.text)) {
          const srcName = spreadElement.expression.text;
          const srcSize = arrayLiteralSizes.get(srcName)!;
          const expandedElements: ExpressionIR[] = [];
          for (let i = 0; i < srcSize; i++) {
            expandedElements.push({ kind: "raw", value: `${srcName}[${i}]` });
          }
          for (const elem of expr.elements.slice(spreadIndex + 1)) {
            expandedElements.push(expressionToIR(elem, sourceText, diagnostics));
          }
          return { kind: "array", elementType: "auto", elements: expandedElements };
        }
        const spreadExpr = expressionToIR(spreadElement.expression, sourceText, diagnostics);
        const additionalElements = expr.elements
          .slice(spreadIndex + 1)
          .map(e => expressionToIR(e, sourceText, diagnostics));

        // Emit as spread_array IR node
        return {
          kind: "spread_array",
          elementType: "auto",
          spreadExpr,
          additionalElements
        };
      }
    }
    
    const nonOmittedElements = expr.elements.filter(e => e.kind !== ts.SyntaxKind.OmittedExpression);
    const elements = nonOmittedElements
      .map((e) => expressionToIR(e, sourceText, diagnostics));
    // Resolve the element cppType when possible so downstream renderers can emit
    // a TYPED `std::vector<ElemType>{...}`. This matters when an inline array
    // literal is the receiver of a `__tc_*` template helper
    // (`[...].join(sep)`, `[...].concat(x)`, ...): a bare `{...}` cannot drive
    // template argument deduction, but `std::vector<std::string>{...}` can.
    // Infer from the first element's resolved cppType; fall back to `"auto"`
    // (the historical default) when no element carries a type. Demo #29 Finding D.
    const elementType = inferArrayElementType(nonOmittedElements);
    return { kind: "array", elementType, elements };
  }

  // Handle object literals - suppress warning for compile-time type contexts
  // Object literals in board package files are often type-asserted to pin interfaces
  // These are compile-time constructs that don't need C++ emission
  if (ts.isObjectLiteralExpression(expr)) {
    const fields: { name: string; value: ExpressionIR }[] = [];
    const spreadSources: ExpressionIR[] = [];
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: expressionToIR(prop.initializer, sourceText, diagnostics, pointerVars),
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        fields.push({
          name: prop.name.text,
          value: { kind: "identifier", value: prop.name.text },
        });
      } else if (ts.isMethodDeclaration(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* method stub */" },
        });
      } else if (ts.isAccessor(prop)) {
        const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
        fields.push({
          name,
          value: { kind: "raw", value: "/* accessor stub */" },
        });
      } else if (ts.isSpreadAssignment(prop)) {
        spreadSources.push(expressionToIR(prop.expression, sourceText, diagnostics, pointerVars));
      }
    }
    if (fields.length === 0 && spreadSources.length > 0) {
      const allFields: { name: string; value: ExpressionIR }[] = [];
      for (const src of spreadSources) {
        allFields.push({ name: "__spread__", value: src });
      }
      return { kind: "object", fields: allFields };
    }
    if (spreadSources.length > 0 && fields.length > 0) {
      const allFields: { name: string; value: ExpressionIR }[] = [];
      for (const src of spreadSources) {
        const srcText = renderExprAsText(src);
        allFields.push({ name: "__spread__", value: src });
      }
      allFields.push(...fields);
      return { kind: "object", fields: allFields };
    }
    return { kind: "object", fields };
  }

// Handle function expressions and arrow functions in compile-time contexts
  // These are stubs in board package files that get replaced by transpiler magic
  // For interrupt handlers, we need to generate a proper callback function
  if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
    const body = expr.body;

    // Resolve each parameter's C++ type from its type annotation rather than
    // hardcoding "auto". This matters for callbacks hoisted to free functions
    // (top-level-prep.ts collectCallbackFromExpression): the ISR signature is
    // rendered from these cppTypes, and an "auto" param is filtered out, so a
    // `.map((n) => ...)` callback would lower to `void X_isr_N()` (no params)
    // and the __tc_map template couldn't deduce the element/result types.
    // Default to "auto" only when the param has no annotation.
    const paramList: {name: string; cppType: string}[] = [];
    const lambdaLocalTypes = new Map<string, CppTypeHint>();
    for (const param of expr.parameters) {
      if (ts.isIdentifier(param.name)) {
        const resolved = typeNodeToCppType(param.type, undefined);
        const cppType = resolved && resolved !== "auto" ? resolved : "auto";
        paramList.push({
          name: param.name.text,
          cppType,
        });
        if (cppType !== "auto") {
          lambdaLocalTypes.set(param.name.text, cppType);
        }
      }
    }

    const isBlock = ts.isBlock(body);
    // Lambda bodies run at an unmodeled time (callbacks), so pin-state
    // constant folding must be off inside them.
    const bodyStmts: StatementIR[] = isBlock
      ? (body as ts.Block).statements.map(stmt => {
          const lowered = lowerStatement(
            stmt,
            "",
            sourceText,
            diagnostics,
            new Map(),
            new Map(),
            "<lambda>",
            new Map(),
            pointerVars,
          );
          const stmts = lowered ?? [{ kind: "call" as const, sourceSpan: makeSourceSpan(stmt, "", sourceText), callee: "__EMIT__", args: [{ kind: "string" as const, value: "" }] }];
          return stmts;
        }).flat()
      : [{
          kind: "return" as const,
          sourceSpan: makeSourceSpan(body, "", sourceText),
          value: expressionToIR(body, sourceText, diagnostics, pointerVars),
      }];

    // Infer return type: use explicit annotation, or infer from body. Thread
    // the lambda's own param types into the inference so a body like
    // `(n) => n.capacity` can resolve `n` and deduce the return type.
    // When the body returns a value but the type can't be resolved (common when
    // the param is an interface, whose fields aren't in the class registry),
    // fall back to "auto" (C++14 return-type deduction) rather than "void" —
    // this lets the __tc_map/__tc_filter template helpers deduce the result
    // type via decltype(fn(v[0])) instead of failing on a void(auto) callable.
    let inferredReturnType: string;
    const explicitReturnType = typeNodeToCppType(expr.type, undefined);
    if (explicitReturnType !== "auto" && explicitReturnType !== "void") {
      inferredReturnType = explicitReturnType;
    } else if (isBlock) {
      const returns = collectReturns(body as ts.Block).filter((item) => item.expression);
      const returnTypes = returns
        .map((item) => inferExprCppType(item.expression as ts.Expression, new Map(), lambdaLocalTypes, sourceText))
        .filter((item) => item !== "auto");
      if (returnTypes.includes("float") || returnTypes.includes("double")) {
        inferredReturnType = "double";
      } else if (returnTypes.includes("std::string")) {
        inferredReturnType = "std::string";
      } else if (returnTypes.includes("int") || returnTypes.includes("bool")) {
        inferredReturnType = "int";
      } else if (returnTypes.length > 0) {
        inferredReturnType = returnTypes[0];
      } else {
        // Body has returns but the types didn't resolve (e.g. interface-typed
        // param). Use C++14 auto return deduction so the callback is callable.
        inferredReturnType = returns.length > 0 ? "auto" : "void";
      }
    } else {
      inferredReturnType = inferExprCppType(body, new Map(), lambdaLocalTypes, sourceText);
      if (inferredReturnType === "auto") {
        // Expression body whose type didn't resolve — still prefer auto over
        // void so the value is returned (not dropped).
        inferredReturnType = "auto";
      }
    }

    const lambdaParams = paramList.map(p => ({ name: p.name, cppType: p.cppType }));
    return { kind: "lambda", params: lambdaParams, body: bodyStmts, returnType: inferredReturnType, isExpressionBody: !isBlock } as ExpressionIR;
  }

  // Handle instanceof expressions
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
    const object = expressionToIR(expr.left, sourceText, diagnostics);
    const className = expr.right.getText();
    return { kind: "instanceof", object, className };
  }

  // Handle class expressions (anonymous classes assigned to variables)
  if (ts.isClassExpression(expr)) {
    const className = expr.name ? expr.name.text : `__tc_anonClass`;
    const members: any[] = [];
    let ctor: any;
    const fields: any[] = [];
    const methods: any[] = [];
    const getters: any[] = [];
    const setters: any[] = [];

    for (const member of expr.members) {
      if (ts.isConstructorDeclaration(member)) {
        const ctorParams: any[] = [];
        for (const param of member.parameters) {
          if (ts.isIdentifier(param.name)) {
            ctorParams.push({ name: param.name.text, cppType: "auto", isRest: !!param.dotDotDotToken });
          }
        }
        const ctorBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), "<anon-class>", new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        ctor = { parameters: ctorParams, statements: ctorBody };
        continue;
      }
      if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const methodBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        methods.push({
          name: member.name.text,
          returnType: "auto",
          parameters: [],
          statements: methodBody,
          visibility: "public" as const,
          isStatic: false,
          isAbstract: false,
        });
        continue;
      }
      if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        fields.push({
          name: member.name.text,
          cppType: "auto",
          visibility: "public" as const,
          initializer: member.initializer ? expressionToIR(member.initializer, sourceText, diagnostics, pointerVars) : undefined,
        });
        continue;
      }
      if (ts.isGetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const getterBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.get:${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        getters.push({
          name: member.name.text,
          returnType: "auto",
          statements: getterBody,
          visibility: "public" as const,
          isStatic: false,
        });
        continue;
      }
      if (ts.isSetAccessorDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const setterBody = member.body
          ? [...member.body.statements as any].map(s => {
              const lowered = lowerStatement(s, "", sourceText, diagnostics, new Map(), new Map(), `<anon-class>.set:${member.name!.getText()}`, new Map(), pointerVars);
              return lowered ?? [];
            }).flat()
          : [];
        setters.push({
          name: member.name.text,
          parameter: { name: "value", cppType: "auto", isRest: false },
          statements: setterBody,
          visibility: "public" as const,
          isStatic: false,
        });
        continue;
      }
    }

    const syntheticSpan = { filePath: "", startOffset: 0, endOffset: 0, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
    hoistedNestedClasses.push({
      name: className,
      isAbstract: false,
      sourceSpan: syntheticSpan,
      fields,
      methods,
      getters,
      setters,
      ...(ctor ? { constructor: ctor } : {}),
    });
    topLevelClassNames.add(className);
    classTypeNames.add(className);

    const extendsClass = expr.heritageClauses
      ?.find((clause: ts.HeritageClause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression?.getText();
    if (extendsClass) {
      hoistedNestedClasses[hoistedNestedClasses.length - 1].extendsClass = extendsClass;
    }

    return { kind: "identifier", value: className };
  }

  // Handle delete expressions: delete obj.key → map.erase(key)
  if (ts.isDeleteExpression(expr)) {
    const target = expr.expression;
    if (ts.isPropertyAccessExpression(target)) {
      const keyText = target.name.text;
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = getCurrentIrTypeScope()?.locals.get(objNode.text) ?? getCurrentIrTypeScope()?.globals.get(objNode.text);
      }
      if (objType && (parsedIsMap(objType) || parsedIsSet(objType))) {
        return { kind: "raw", value: `(${objText}.erase(${keyText}), true)` };
      }
      if (objType && parsedIsVector(objType)) {
        const elemText = renderExprAsText(expressionToIR(target, sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `(${objText}.erase(std::find(${objText}.begin(), ${objText}.end(), ${keyText})), true)` };
      }
    }
    if (ts.isElementAccessExpression(target)) {
      const keyIR = expressionToIR(target.argumentExpression, sourceText, diagnostics, pointerVars);
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      const keyText = renderExprAsText(keyIR);
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = getCurrentIrTypeScope()?.locals.get(objNode.text) ?? getCurrentIrTypeScope()?.globals.get(objNode.text);
      }
      if (objType && parsedIsMap(objType)) {
        return { kind: "raw", value: `(${objText}.erase(${keyText}) > 0)` };
      }
    }

    if (ts.isPropertyAccessExpression(target)) {
      const keyText = target.name.text;
      const objNode = target.expression;
      const objText = renderExprAsText(expressionToIR(objNode, sourceText, diagnostics, pointerVars));
      let objType: string | undefined;
      if (ts.isIdentifier(objNode)) {
        objType = getCurrentIrTypeScope()?.locals.get(objNode.text) ?? getCurrentIrTypeScope()?.globals.get(objNode.text);
      }
      if (objType) {
        const fieldTypeName = objType;
        let defaultValue = "0";
        if (fieldTypeName === "std::string" || fieldTypeName === "const char*") defaultValue = "\"\"";
        else if (fieldTypeName === "bool") defaultValue = "false";
        else if (parsedIsPointer(fieldTypeName)) defaultValue = "nullptr";
        return { kind: "raw", value: `(${objText}.${keyText} = ${defaultValue}, true)` };
      }
    }

    return emitUnsupportedExpression("delete on non-map types is unsupported in C++.");
  }

  // Handle comma expressions: (a, b, c) → evaluate all, return last
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    const leftIR = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
    const rightIR = expressionToIR(expr.right, sourceText, diagnostics, pointerVars);
    const leftText = renderExprAsText(leftIR);
    const rightText = renderExprAsText(rightIR);
    return { kind: "raw", value: `(${leftText}, ${rightText})` };
  }

  // Handle tagged template expressions (e.g., tag`template`)
  if (ts.isTaggedTemplateExpression(expr)) {
    return emitUnsupportedExpression("Tagged template expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  // Handle meta properties (e.g., import.meta, new.target)
  if (ts.isMetaProperty(expr)) {
    return emitUnsupportedExpression("Meta-property expressions are unsupported in the C++ transpiler and were lowered to a placeholder.");
  }

  if (ts.isNonNullExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  if (expr.kind === ts.SyntaxKind.SuperKeyword) {
    const extendsClass = getActiveExtendsClass();
    if (extendsClass) {
      return { kind: "raw", value: extendsClass };
    }
    return emitUnsupportedExpression("super keyword outside of class method");
  }

  if (ts.isPartiallyEmittedExpression(expr)) {
    return expressionToIR(expr.expression, sourceText, diagnostics, pointerVars);
  }

  if (expr.kind === (ts.SyntaxKind as any).YieldExpression || (ts as any).isYieldExpression?.(expr)) {
    const yieldExpr = expr as any;
    const value = yieldExpr.expression
      ? expressionToIR(yieldExpr.expression, sourceText, diagnostics, pointerVars)
      : undefined;
    return { kind: "raw", value: value ? `co_yield ${renderExprAsText(value)}` : "co_yield" };
  }

  return emitUnsupportedExpression(
    `Unsupported expression kind '${ts.SyntaxKind[expr.kind] ?? expr.kind}' was lowered to a placeholder.`,
  );
}
