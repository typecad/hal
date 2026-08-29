import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, ExpressionIR } from "../../api/index.js";
import { arrayLiteralSizes, mutableArrayVars, activeCArrayVars, getContext, activeEnumNames, activeStringEnumNames } from "../build-ir-state.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { renderExprAsText } from "../render-expr.js";
import { assignmentOperatorToString } from "./variables.js";
import { STRING_METHODS, STRING_METHOD_NAMES, StringMethodSpec, StringMethodArgForm } from "../../api/shared/string-method-registry.js";
import { parsedElementString } from "../../api/shared/cpp-type-ir.js";
import { INTEGRAL_CPP_TYPE_RE } from "../../emit/utils/cpp-helpers.js";

// Methods that require StaticArray promotion (not all are mutating — indexOf is read-only
// but needs StaticArray since C arrays don't have an indexOf method).
export const ARRAY_METHODS_REQUIRING_STATIC_ARRAY = new Set(["push", "pop", "indexOf"]);

export function prescanArrayUsage(statement: ts.Statement): void {
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          arrayLiteralSizes.set(decl.name.text, decl.initializer.elements.length);
        }
        prescanExprForArrayMethods(decl.initializer);
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isReturnStatement(statement) && statement.expression) {
    prescanExprForArrayMethods(statement.expression);
  } else if (ts.isIfStatement(statement)) {
    prescanArrayUsageBlock(statement.thenStatement);
    if (statement.elseStatement) prescanArrayUsageBlock(statement.elseStatement);
  } else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    prescanArrayUsageBlock(statement.statement);
  } else if (ts.isBlock(statement)) {
    for (const s of statement.statements) prescanArrayUsage(s);
  }
}

function prescanArrayUsageBlock(stmt: ts.Statement): void {
  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) prescanArrayUsage(s);
  } else {
    prescanArrayUsage(stmt);
  }
}

export function prescanExprForArrayMethods(expr: ts.Expression): void {
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (ARRAY_METHODS_REQUIRING_STATIC_ARRAY.has(methodName) && ts.isIdentifier(expr.expression.expression)) {
      const varName = expr.expression.expression.text;
      mutableArrayVars.add(varName);
    }
  }
  // Detect indexed assignment (arr[i] = val and compounds like arr[i] += val).
  // TypeScript const only locks the binding, not the array contents, so
  // assigning to an element forces non-const C++ storage (matching the
  // existing behaviour for .push() / .pop()).
  if (ts.isBinaryExpression(expr)
      && ts.isElementAccessExpression(expr.left)
      && ts.isIdentifier(expr.left.expression)
      && assignmentOperatorToString(expr.operatorToken.kind) !== undefined) {
    mutableArrayVars.add(expr.left.expression.text);
  }
  // Detect element increment / decrement (arr[i]++ / arr[i]-- / ++arr[i] / --arr[i]).
  if ((ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr))
      && ts.isElementAccessExpression(expr.operand)
      && ts.isIdentifier(expr.operand.expression)
      && (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken)) {
    mutableArrayVars.add(expr.operand.expression.text);
  }
}

export function buildInlineForLoop(
  span: any,
  srcSize: number,
  srcName: string,
  paramName: string,
  bodyExpr: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  assignTarget: string,
  _isFilter: boolean,
): StatementIR {
  const bodyIR = expressionToIR(bodyExpr, sourceText, diagnostics);
  return {
    kind: "for",
    sourceSpan: span,
    initializer: { kind: "var_decl", sourceSpan: span, name: "__tc_i", storage: "let", cppType: "int", initializer: { kind: "number", value: 0 } },
    condition: { kind: "binary", left: { kind: "identifier", value: "__tc_i" }, operator: "<", right: { kind: "number", value: srcSize } },
    increment: { kind: "update", sourceSpan: span, target: "__tc_i", operator: "++", prefix: false },
    body: [
      { kind: "var_decl", sourceSpan: span, name: paramName, storage: "const", cppType: "auto",
        initializer: { kind: "raw", value: `${srcName}[__tc_i]` } },
      { kind: "assign", sourceSpan: span, target: assignTarget, operator: "=", value: bodyIR },
    ],
  };
}

// Structural lowering of TS array/collection methods on std::vector receivers
// to their __tc_* helper form, at IR-build time. This replaces the regex-based
// lowering that formerly lived in framework-native/strategy.ts
// `normalizeRawExpression` (which operated on already-rendered C++ text and
// captured the receiver with a RECV regex — the demo #22 failure class).
//
// Methods split into two groups:
//  - VALUE-ARG methods (.push/.pop/.shift/.fill/.concat/.splice/.slice/...):
//    args are plain values, so the whole call collapses to a `raw` IR node
//    whose text is the helper form. Safe because there are no callbacks.
//  - CALLBACK-ARG methods (.map/.filter/.reduce/.find/.findIndex/.every/.some/
//    .sort(fn)): the callback argument MUST stay a structured IR node so the
//    emit-time callback hoister (top-level-prep.ts collectCallbacks) can find
//    it, hoist it to a named _isr_N function, and substitute the name. A `raw`
//    node is opaque to the hoister (it returns early on kind==="raw"), so these
//    lower to a `method-call` IR node whose callee is the helper and whose args
//    are [receiverIR, ...argIRs] — preserving the structured callback.
type ArgTexts = string[];
// Returns the lowered C++ expression text, or null if this call shape isn't
// handled (e.g. `.slice()` only matches the zero-arg copy form).
type ValueMethodLowering = (recv: string, args: ArgTexts, argCount: number) => string | null;

const VECTOR_VALUE_METHOD_LOWERINGS: Record<string, ValueMethodLowering> = {
  // Mutators that the native runtime exposes as free-function helpers:
  pop: (r) => `__tc_pop(${r})`,
  shift: (r) => `__tc_shift(${r})`,
  reverse: (r) => `__tc_reverse(${r})`,
  unshift: (r, [a]) => `__tc_unshift(${r}, ${a})`,
  // .fill(v) vs .fill(v, start, end)
  fill: (r, args, n) => n >= 3 ? `__tc_fill3(${r}, ${args[0]}, ${args[1]}, ${args[2]})` : `__tc_fill(${r}, ${args[0] ?? ""})`,
  concat: (r, [a]) => `__tc_concat(${r}, ${a})`,
  // .splice(i) vs .splice(i, n)
  splice: (r, args, n) => n >= 2 ? `__tc_splice2(${r}, ${args[0]}, ${args[1]})` : `__tc_splice1(${r}, ${args[0]})`,
  // .slice() with no args copies the whole vector. (Sliced sub-ranges are not
  // handled here — they didn't have a regex either.)
  slice: (r, _args, n) => n === 0
    ? `std::vector<typename std::decay<decltype(${r})>::type>(${r}.begin(), ${r}.end())`
    : null,
  // .join(delim) — folds a std::vector<T> into a std::string with `delim`
  // between elements (the __tc_join template helper). Demo #31 Finding B —
  // `join` was previously misclassified as a STRING method (it was listed in
  // STRING_METHODS even though it operates on a vector), so on a known
  // `mutableArrayVars` receiver (a `string[]` built via .push) BOTH lowering
  // paths declined it: the string path rejects known arrays, and this vector
  // table had no `join` entry. The call was then emitted verbatim and g++
  // rejected it. `join` is a vector→string transformation; it lives here.
  join: (r, [a]) => `__tc_join(${r}, ${a ?? '""'})`,
};

// Callback-arg methods: map method name → helper callee. The receiver and all
// args (including the callback) become structured method-call args so the
// callback hoister can find and name them. `.sort()` with NO arg is a value
// method (`__tc_sort(recv)`), handled separately below.
const VECTOR_CALLBACK_METHOD_HELPERS: Record<string, string> = {
  filter: "__tc_filter",
  map: "__tc_map",
  find: "__tc_find",
  findIndex: "__tc_findIndex",
  every: "__tc_every",
  some: "__tc_some",
  reduce: "__tc_reduce",     // 2-arg form; 1-arg → __tc_reduce_no_init (below)
  sort: "__tc_sort_fn",      // .sort(fn); bare .sort() → __tc_sort (below)
};

/**
 * Render an array/string-method RECEIVER for use as a `__tc_*` helper argument.
 *
 * The only difference from a plain `renderExprAsText(expressionToIR(receiver))`
 * is the INLINE ARRAY LITERAL case: `[...].join(sep)`, `[...].concat(x)`, ....
 * The `__tc_*` helpers are templates, and a bare brace-init-list (`{ ... }`)
 * CANNOT drive template argument deduction (g++: "couldn't deduce template
 * parameter 'T'"). A typed `std::vector<ElemType>{ ... }` temporary CAN. So
 * when the receiver is an inline array literal whose element type we can infer
 * (from a literal element), we wrap it in `std::vector<ElemType>{ ... }`. A
 * NAMED receiver (`x.join(...)` where `x: string[]`) already has a concrete
 * `std::vector<...>` type and is rendered verbatim.
 *
 * Demo #29 Finding D. This is intentionally scoped to the method-receiver
 * position: a bare `{ ... }` is correct in direct-initialization
 * (`const T x = {...}`) and HAL argument (`Wire.write({...})`) contexts, so the
 * type-qualification happens ONLY here, not in the generic array renderer.
 */
function renderArrayMethodReceiver(
  receiverNode: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: any,
): string {
  const ir = expressionToIR(receiverNode, sourceText, diagnostics, pointerVars);
  const text = renderExprAsText(ir);
  // Only an inline array literal needs type-qualification for deduction.
  if (ir.kind === "array" && ir.elementType && ir.elementType !== "auto") {
    return `std::vector<${ir.elementType}>${text}`;
  }
  return text;
}

export function tryLowerArrayAndStringMethods(
  expr: ts.CallExpression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: any,
): ExpressionIR | null {
  if (ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.expression)) {
    const receiverName = expr.expression.expression.text;
    const methodName = expr.expression.name.text;

    // ---- Array method translation for mutable arrays (StaticArray) -----------
    // Translate push → push_back, pop → pop_back, indexOf → indexOf at the expression level.
    // IMPORTANT: this branch emits the StaticArray wrapper's own methods
    // (`__tc_StaticArray` exposes .push/.pop/.indexOf). It must NOT fire for a
    // plain std::vector — even one in mutableArrayVars — because std::vector has
    // no `.push` member (it's `push_back`). The `mutableArrayVars` set is
    // populated by prescan whenever .push/.pop/.indexOf is *called* on a var,
    // regardless of whether that var lowered to StaticArray or std::vector; so
    // gate on the resolved C++ type actually being a StaticArray. A std::vector
    // falls through to the vector-method lowering below (push_back / __tc_pop).
    if (mutableArrayVars.has(receiverName)) {
      const resolvedType = getCurrentIrTypeScope()?.locals.get(receiverName) ?? getCurrentIrTypeScope()?.globals.get(receiverName);
      // Use the StaticArray wrapper's own methods (.push/.pop/.indexOf) ONLY when
      // the receiver genuinely lowered to a __tc_StaticArray. The resolved C++
      // type is the primary signal, BUT it can be stale: the StaticArray
      // promotion (variables.ts) runs during var_decl processing, AFTER call
      // statements are lowered — so a literal-declared array's type is still
      // "std::vector<...>" (pre-promotion) when its .push statement is lowered.
      // Predict the post-promotion type instead: if the var is a mutable
      // array-literal on a target that promotes literals to StaticArray, it WILL
      // become a __tc_StaticArray, so use the StaticArray form. Native does not
      // promote (promotesArrayLiteralsToStaticArray() = false), so its
      // std::vector type is genuine and the vector lowering below applies.
      const typeIsStaticArray = !!resolvedType && (resolvedType.startsWith("StaticArray<") || resolvedType.startsWith("__tc_StaticArray<"));
      const promotesLiterals = getContext().activeStrategy?.promotesArrayLiteralsToStaticArray?.() ?? true;
      const willPromoteToStaticArray = promotesLiterals && arrayLiteralSizes.has(receiverName);
      const isStaticArrayType = typeIsStaticArray || willPromoteToStaticArray;
      if (isStaticArrayType) {
      if (methodName === "pop") {
        return { kind: "raw", value: `${receiverName}.pop()` };
      }
      if (methodName === "push") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `${receiverName}.push(${argsText})` };
      }
      if (methodName === "indexOf") {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
        return { kind: "raw", value: `(${receiverName}).indexOf(${argsText})` };
      }
      }
    }

    // ---- String indexOf wrapping (const char* needs String() on Arduino) ---
    if (methodName === "indexOf" &&
        !mutableArrayVars.has(receiverName) &&
        !activeCArrayVars.has(receiverName)) {
      return {
        kind: "method-call",
        callee: `${receiverName}.indexOf`,
        args: expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars))
      };
    }
  }

  // ---- Structural vector-method lowering (replaces normalizeRawExpression regexes) ----
  // For a std::vector receiver of ANY shape (bare name OR member chain like
  // `this->ops`, `obj.field`), lower the TS array method to its __tc_* helper
  // at IR-build time. The receiver is rendered via expressionToIR so the
  // pointer/value access decision (this->ops vs obj.field) is already correct,
  // and the helper receives it as a normal argument — no RECV regex needed.
  // Gated on method name only, matching the prior regex behavior (TS type
  // semantics guarantee these names on a non-array/vector would be a type
  // error). `push` is special-cased to `push_back` (the native inlining).
  //
  // Target gate: the __tc_* helpers are native/hosted-only (Arduino/embedded
  // lower arrays to StaticArray, caught by the mutableArrayVars branch above,
  // and have no __tc_* polyfills). Two signals compose: the target has no
  // repeatedly-called loop() (requiresLoopFunction() false — the historical
  // proxy for "hosted"), AND it actually carries std::vector (getStdLibSupport
  // ().hasVector). The second signal matters because a main()-entry RTOS
  // target (Zephyr) also reports requiresLoopFunction()=false but lowers
  // arrays to __tc_StaticArray — without the hasVector conjunct it would
  // wrongly take the std::vector/.push_back path.
  const strat = getContext().activeStrategy;
  const isHostedTarget = !strat?.requiresLoopFunction()
    && (strat?.getStdLibSupport?.().hasVector ?? true);
  if (isHostedTarget && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    // `push` lowers to native push_back (matches the old
    // `${RECV}\.push(([^)]+)\)` → `$1.push_back($2)` regex).
    if (methodName === "push") {
      const receiverNode = expr.expression.expression;
      const receiverText = renderExprAsText(expressionToIR(receiverNode, sourceText, diagnostics, pointerVars));
      const argsText = expr.arguments.map(arg => renderPushArgForElement(arg, receiverNode, sourceText, diagnostics, pointerVars)).join(", ");
      return { kind: "raw", value: `${receiverText}.push_back(${argsText})` };
    }
    // `sort()` with no arg and `reduce` with one arg have distinct helpers.
    if (methodName === "sort" && expr.arguments.length === 0) {
      const receiverText = renderArrayMethodReceiver(expr.expression.expression, sourceText, diagnostics, pointerVars);
      return { kind: "raw", value: `__tc_sort(${receiverText})` };
    }
    if (methodName === "reduce" && expr.arguments.length === 1) {
      const receiverText = renderArrayMethodReceiver(expr.expression.expression, sourceText, diagnostics, pointerVars);
      const cbText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
      return { kind: "raw", value: `__tc_reduce_no_init(${receiverText}, ${cbText})` };
    }
    // Callback-arg methods: lower to a method-call IR node (NOT raw) so the
    // emit-time callback hoister (top-level-prep.ts collectCallbacks) can find
    // the structured callback arg in `args`, hoist it to a named _isr_N
    // function, and substitute the name. A raw node is opaque to the hoister.
    const cbHelper = VECTOR_CALLBACK_METHOD_HELPERS[methodName];
    if (cbHelper) {
      // An inline array-literal receiver must be type-qualified so the
      // `__tc_*` template helper can deduce its element type (demo #29 Finding D).
      // Wrap an array-literal receiverIR into a typed raw node.
      const receiverIR = (() => {
        const ir = expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars);
        if (ir.kind === "array" && ir.elementType && ir.elementType !== "auto") {
          return { kind: "raw" as const, value: `std::vector<${ir.elementType}>${renderExprAsText(ir)}` };
        }
        return ir;
      })();
      const argIRs = expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars));
      return { kind: "method-call", callee: cbHelper, args: [receiverIR, ...argIRs] };
    }
    // Value-arg methods: collapse to a raw helper call (no callbacks to hoist).
    const lowering = VECTOR_VALUE_METHOD_LOWERINGS[methodName];
    if (lowering) {
      const receiverText = renderArrayMethodReceiver(expr.expression.expression, sourceText, diagnostics, pointerVars);
      const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)));
      const lowered = lowering(receiverText, argsText, expr.arguments.length);
      if (lowered !== null) {
        return { kind: "raw", value: lowered };
      }
    }

    // ---- String-method lowering (structural) ------------------------------
    // Demo #27 Findings D/E — string methods (`s.toLowerCase()`,
    // `s.substring(0,2)`, `s.charAt(i)`, ...) were previously lowered by a
    // post-emit text rewrite (`applyStringMethodRewrites`) whose
    // `RECEIVER_PATTERN` only matched bare identifiers and `.member` chains —
    // NOT `X[i]` element access or `X->member` pointer chains. So
    // `ALPHABET[i].toLowerCase()` was left verbatim (g++: "no member
    // 'toLowerCase'"), and even on a bare local the emitted `__tc_toLowerCase`
    // helper was never registered (the text scan missed it). Array mutators
    // were migrated off the same regex family in demo #22 into this
    // structural path; string methods are routed through the identical path
    // here, so the receiver is rendered via `expressionToIR` (handling
    // bare id / `this.field` / `obj.field` / `X[i]` / chains uniformly) and
    // the helper lands in a `raw` IR node that `program-analysis.ts` scans to
    // register the polyfill.
    //
    // Gate: only fire for a KNOWN string method whose receiver is NOT a known
    // array (the array paths above already handled array `indexOf`/`slice`/
    // etc.). For methods that exist on BOTH strings and arrays
    // (`indexOf`/`includes`/`startsWith`/`endsWith`/`slice`/`substring`), gate
    // on the receiver's resolved C++ type being string-like, so an array
    // `indexOf` is never mis-lowered to the string helper.
    const isStringMethod = STRING_METHOD_NAMES.has(methodName);
    if (isStringMethod) {
      const receiverNode = expr.expression.expression;
      // Use renderArrayMethodReceiver so an INLINE array-literal receiver of an
      // ambiguous string/array method (`.join`, `.concat`, `.slice`, ...) is
      // type-qualified into `std::vector<ElemType>{...}` — the `__tc_*` helpers
      // are templates and a bare brace-init-list cannot drive deduction. A
      // genuine string receiver passes through unchanged. Demo #29 Finding D.
      const receiverText = renderArrayMethodReceiver(receiverNode, sourceText, diagnostics, pointerVars);
      if (shouldLowerAsStringMethod(receiverNode, methodName)) {
        const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)));
        const lowered = lowerStringMethod(methodName, receiverText, argsText, expr.arguments.length);
        if (lowered !== null) {
          return { kind: "raw", value: lowered };
        }
      }
    }
  }

  return null;
}

// Methods that exist on BOTH std::string and std::vector (so the receiver
// type must be consulted to decide). All other STRING_METHOD_NAMES are
// unambiguously string-only.
const AMBIGUOUS_STRING_METHODS = new Set(["indexOf", "includes", "startsWith", "endsWith", "slice", "substring"]);

/**
 * Decide whether `receiver.methodName(...)` should lower as a STRING method
 * (→ `__tc_*` helper) rather than being left for the array path. Returns true
 * for unambiguously-string methods (toLowerCase, charAt, ...), and for the
 * ambiguous overlap methods only when the receiver's resolved C++ type is
 * string-like (`std::string`/`const char*`/`char*`). Known arrays
 * (`mutableArrayVars`/`activeCArrayVars`) are always rejected so an array
 * `indexOf` is never mis-lowered.
 */
function shouldLowerAsStringMethod(receiverNode: ts.Expression, methodName: string): boolean {
  // Known array receivers are never string-method receivers.
  if (ts.isIdentifier(receiverNode)) {
    if (mutableArrayVars.has(receiverNode.text) || activeCArrayVars.has(receiverNode.text)) {
      return false;
    }
  }
  if (!AMBIGUOUS_STRING_METHODS.has(methodName)) {
    // Unambiguously a string method (toLowerCase/trim/charAt/charCodeAt/...).
    return true;
  }
  // Ambiguous: decide by the receiver's resolved C++ type.
  const resolvedType = resolveReceiverCppType(receiverNode);
  return resolvedType === "std::string" || resolvedType === "const char*" || resolvedType === "char*";
}

/**
 * Resolve the C++ type of a receiver expression for the string/array
 * disambiguation. Handles bare identifiers (scope lookup), `this.field`
 * (`this->field` in the scope map), element access (`arr[i]` — derives the
 * container's element type), and `obj.field` chains (best-effort). Returns
 * undefined if unknown.
 *
 * Element access is the case demo #27 Finding D stressed: `words[i].substring`
 * where `words: string[]`. The container resolves to `std::vector<std::string>`
 * and the element type is `std::string`, so the ambiguous `substring`/`slice`
 * methods lower as string methods. Without this, an indexed receiver resolved
 * to `undefined` and the ambiguous-method gate rejected the lowering.
 */
function resolveReceiverCppType(receiverNode: ts.Expression): string | undefined {
  const scope = getCurrentIrTypeScope();
  if (!scope) return undefined;
  if (ts.isIdentifier(receiverNode)) {
    return scope.locals.get(receiverNode.text) ?? scope.globals.get(receiverNode.text);
  }
  if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return scope.locals.get(`this->${receiverNode.name.text}`);
  }
  if (ts.isElementAccessExpression(receiverNode)) {
    // Derive the element type of the indexed container.
    const containerType = resolveReceiverCppType(receiverNode.expression);
    if (containerType) {
      const element = parsedElementString(containerType);
      if (element) return element;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Render a `.push(arg)` argument, casting it across the enum↔integral storage
 * boundary when the receiver is an integral-element vector and the argument is
 * a numeric-enum value. The IR-build-time counterpart to the emit-layer
 * `renderValueForTarget`: `.push` lowers to a raw `recv.push_back(ARG)` callee
 * with the argument baked into the text, so the boundary must be handled HERE
 * (the emit layer never sees the argument as a structured value).
 *
 * Detection (structural, not regex):
 *   - Resolve the receiver's C++ type and derive its element type
 *     (`std::vector<uint8_t>` → `uint8_t`).
 *   - Detect a numeric-enum argument: a property access on a name in
 *     `activeEnumNames` (`Cell.Dead`), or a bare identifier whose scope type is
 *     an enum. String-enum members lower to `const char*` and are never cast.
 *
 * When the element type is integral and the arg is a numeric-enum value, wrap
 * the rendered arg in `static_cast<int>(...)`. Demo #32 Finding A. Mirrors the
 * enum↔integral family fixed at the assign/var_decl sites in the emit layer.
 */
function renderPushArgForElement(
  argNode: ts.Expression,
  receiverNode: ts.Expression,
  sourceText: string,
  diagnostics: Diagnostic[],
  pointerVars: any,
): string {
  const rendered = renderExprAsText(expressionToIR(argNode, sourceText, diagnostics, pointerVars));
  // Resolve the receiver element type.
  const receiverType = resolveReceiverCppType(receiverNode);
  const elementType = receiverType ? parsedElementString(receiverType) : undefined;
  const targetIsIntegral = !!elementType && INTEGRAL_CPP_TYPE_RE.test(elementType);
  if (!targetIsIntegral) return rendered;
  // Detect a numeric-enum argument (excluding string enums).
  const argEnumName = numericEnumNameOfArg(argNode);
  if (!argEnumName) return rendered;
  if (/^static_cast<[^>]+>\(/.test(rendered)) return rendered;
  return `static_cast<int>(${rendered})`;
}

/**
 * Returns the enum name when `node` is a numeric-enum value: either
 * `EnumName.Member` (property access on a name in `activeEnumNames`, not a
 * string enum) or a bare identifier whose IR-scope type is a numeric enum.
 * Returns undefined for string enums and non-enum nodes. Demo #32 Finding A.
 */
function numericEnumNameOfArg(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    if (activeEnumNames.has(name) && !activeStringEnumNames.has(name)) return name;
  }
  if (ts.isIdentifier(node)) {
    const scope = getCurrentIrTypeScope();
    const t = scope?.locals.get(node.text) ?? scope?.globals.get(node.text);
    if (t && activeEnumNames.has(t) && !activeStringEnumNames.has(t)) return t;
  }
  return undefined;
}

/**
 * Lower a string method to its `__tc_*` helper call, picking the helper by
 * method name AND argument count (so `substring(0,2)` → `__tc_substring2` and
 * `substring(2)` → `__tc_substring1`). Returns null if no spec matches the
 * call's arity (e.g. the demo's `slice()` zero-arg copy form belongs to the
 * vector path, not here).
 *
 * Built from `STRING_METHODS`, which encodes arity in the helper name
 * (`__tc_substring2` / `__tc_substring1`) and argForm. The original
 * `STRING_METHOD_BY_NAME` map in `string-method-registry.ts` collapses both
 * arities onto one key (fine for the names-set, wrong for lowering), so this
 * lookup is keyed by `${name}:${argForm}` instead.
 *
 * Native `startsWith` maps to `std::string::rfind` (the prior `special`
 * override) instead of the `__tc_*` helper.
 */
const STRING_HELPER_BY_NAME_FORM: Map<string, StringMethodSpec> = new Map();
for (const spec of STRING_METHODS) {
  const name = spec.methodName ?? spec.helper.replace(/^__tc_/, "").replace(/_default$/, "").replace(/\d+$/, "");
  STRING_HELPER_BY_NAME_FORM.set(`${name}:${spec.argForm}`, spec);
}

function lowerStringMethod(
  methodName: string,
  receiver: string,
  args: string[],
  argCount: number,
): string | null {
  // Native special case: startsWith → rfind prefix test (no helper).
  if (methodName === "startsWith" && argCount >= 1) {
    return `(${receiver}.rfind(${args[0]}, 0) == 0)`;
  }
  // Map the observed arg count to the argForm that handles it. Methods with a
  // default (`padStart`/`padEnd`) have BOTH a binary and a unaryDefault spec;
  // prefer the binary form when 2 args are given, else the default form.
  const formsForCount: StringMethodArgForm[] =
    argCount === 0 ? ["receiverOnly"]
    : argCount === 1 ? ["unary", "unaryDefault"]
    : argCount === 2 ? ["binary"]
    : [];
  for (const form of formsForCount) {
    const spec = STRING_HELPER_BY_NAME_FORM.get(`${methodName}:${form}`);
    if (!spec) continue;
    switch (form) {
      case "receiverOnly":
        return `${spec.helper}(${receiver})`;
      case "unary":
      case "unaryDefault":
        return `${spec.helper}(${receiver}, ${args[0]})`;
      case "binary":
        return `${spec.helper}(${receiver}, ${args[0]}, ${args[1]})`;
    }
  }
  return null;
}
