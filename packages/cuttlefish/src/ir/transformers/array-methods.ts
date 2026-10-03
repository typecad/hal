import ts from "typescript";
import { Diagnostic } from "../../types.js";
import { StatementIR, ExpressionIR } from "../../api/index.js";
import { arrayLiteralSizes, mutableArrayVars, arrayPushCounts, unboundedArrayVars, moduleArrayLiteralVars, functionScopeMutatedArrays, activeCArrayVars, getContext, activeEnumNames, activeStringEnumNames, requiredIncludes, getActiveClassName, topLevelClasses, hoistedNestedClasses, typeAliasNodes } from "../build-ir-state.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { expressionToIR } from "../expression-to-ir.js";
import { typeNodeToCppType } from "../type-resolution.js";
import { renderExprAsText } from "../render-expr.js";
import { assignmentOperatorToString } from "./variables.js";
import { STRING_METHODS, STRING_METHOD_NAMES, StringMethodSpec, StringMethodArgForm } from "../../api/shared/string-method-registry.js";
import { parsedElementString, parsedIsVector, parsedIsStaticArray, parsedBareString } from "../../api/shared/cpp-type-ir.js";
import { INTEGRAL_CPP_TYPE_RE } from "../../emit/utils/cpp-helpers.js";
import { makeDiagnostic } from "../ast-node-utils.js";

// Methods that require StaticArray promotion (not all are mutating — indexOf/
// includes/lastIndexOf are read-only but need StaticArray since neither C
// arrays nor std::vector have those members; fill/shift/unshift mutate).
export const ARRAY_METHODS_REQUIRING_STATIC_ARRAY = new Set(["push", "pop", "indexOf", "fill", "includes", "lastIndexOf", "shift", "unshift"]);

export function prescanArrayUsage(statement: ts.Statement, moduleScope: boolean = false): void {
  prescanArrayUsageIn(statement, false, moduleScope);
}

// `inLoop` threads loop-nesting through the recursion: a push site inside a
// for/while/do body runs once per iteration, so its count cannot size a
// StaticArray capacity (the var goes to unboundedArrayVars instead).
// `moduleScope` marks a module-level statement list: every array literal it
// declares is a cross-call accumulator (see moduleArrayLiteralVars).
const BUILTIN_ARRAY_CTORS = new Set([
  "Array", "Uint8Array", "Int8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
]);

export const newAllocatedVars = new Set<string>();

function prescanArrayUsageIn(statement: ts.Statement, inLoop: boolean, moduleScope: boolean): void {
  const inFn = !moduleScope;
  if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        if (ts.isArrayLiteralExpression(decl.initializer)) {
          arrayLiteralSizes.set(decl.name.text, decl.initializer.elements.length);
          if (moduleScope) moduleArrayLiteralVars.add(decl.name.text);
        }
        // A variable initialized via `new X(...)` is a CLASS INSTANCE - every
        // `.method()` on it is a user method, never a vector/array semantic
        // op. Generic-class instances (`const s = new Stack<number>()`) were
        // promoted to StaticArray semantics by a later `.push(...)` and the
        // call lowered to `s.push_back(1)` on a `Stack<double>*` (g++:
        // "request for member 'push_back' ... pointer type").
        if (ts.isNewExpression(decl.initializer) && ts.isIdentifier(decl.initializer.expression)
          && /^[A-Z]/.test(decl.initializer.expression.text)
          && !BUILTIN_ARRAY_CTORS.has(decl.initializer.expression.text)) {
          newAllocatedVars.add(decl.name.text);
        }
        prescanExprForArrayMethods(decl.initializer, inLoop, inFn);
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    prescanExprForArrayMethods(statement.expression, inLoop, inFn);
  } else if (ts.isReturnStatement(statement) && statement.expression) {
    prescanExprForArrayMethods(statement.expression, inLoop, inFn);
  } else if (ts.isIfStatement(statement)) {
    prescanArrayUsageBlock(statement.thenStatement, inLoop, moduleScope);
    if (statement.elseStatement) prescanArrayUsageBlock(statement.elseStatement, inLoop, moduleScope);
  } else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    prescanArrayUsageBlock(statement.statement, true, moduleScope);
  } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    prescanArrayUsageBlock(statement.statement, true, moduleScope);
  } else if (ts.isSwitchStatement(statement)) {
    // A switch's case bodies are plain statement lists at the SAME loop
    // depth — a push inside `case X:` of a `while` runs per-iteration. The
    // scan used to stop at the switch: mutation facts (mutableArrayVars,
    // unboundedArrayVars) were lost, the declaration promoted to a
    // StaticArray sized from nothing, and the call sites routed through the
    // vector path — declaration and uses disagreed.
    for (const clause of statement.caseBlock.clauses) {
      for (const s of clause.statements) prescanArrayUsageIn(s, inLoop, moduleScope);
    }
  } else if (ts.isBlock(statement)) {
    for (const s of statement.statements) prescanArrayUsageIn(s, inLoop, moduleScope);
  }
}

function prescanArrayUsageBlock(stmt: ts.Statement, inLoop: boolean, moduleScope: boolean): void {
  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) prescanArrayUsageIn(s, inLoop, moduleScope);
  } else {
    prescanArrayUsageIn(stmt, inLoop, moduleScope);
  }
}

export function prescanExprForArrayMethods(expr: ts.Expression, inLoop: boolean = false, inFunctionScope: boolean = false): void {
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (ARRAY_METHODS_REQUIRING_STATIC_ARRAY.has(methodName) && ts.isIdentifier(expr.expression.expression)) {
      const varName = expr.expression.expression.text;
      if (newAllocatedVars.has(varName)) return; // class instance, not an array
      mutableArrayVars.add(varName);
      if (inFunctionScope) functionScopeMutatedArrays.add(varName);
      // Growing methods contribute to capacity sizing — but only when the
      // site is outside every loop (a loop site runs per-iteration; the
      // count is not a total). inLoop sites mark the var unbounded instead.
      if (methodName === "push" || methodName === "unshift") {
        if (inLoop) {
          unboundedArrayVars.add(varName);
        } else {
          arrayPushCounts.set(varName, (arrayPushCounts.get(varName) ?? 0) + 1);
        }
      }
    }
  }
  // Recurse into call arguments and callback bodies — a handler passed to a
  // HAL registration (`resp.onReceive((len) => { const bytes = [];
  // bytes.push(...) })`) declares arrays it mutates INSIDE the callback; the
  // top-level scan sees only the registration call, so without this the
  // callback's array stays an un-pushable C array. A callback body is
  // re-entrant (invoked per event), so pushes inside one are unbounded.
  if (ts.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      if (!ts.isSpreadElement(arg))
        prescanExprForArrayMethods(arg, inLoop, inFunctionScope);
    }
  }
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    if (ts.isBlock(expr.body)) {
      for (const s of expr.body.statements)
        prescanArrayUsageIn(s, true, false);
    } else {
      prescanExprForArrayMethods(expr.body, inLoop, true);
    }
  }
  if (ts.isParenthesizedExpression(expr)) {
    prescanExprForArrayMethods(expr.expression, inLoop, inFunctionScope);
  }
  // Detect indexed assignment (arr[i] = val and compounds like arr[i] += val).
  // TypeScript const only locks the binding, not the array contents, so
  // assigning to an element forces non-const C++ storage (matching the
  // existing behaviour for .push() / .pop()).
  if (ts.isBinaryExpression(expr)
      && ts.isElementAccessExpression(expr.left)
      && ts.isIdentifier(expr.left.expression)
      && assignmentOperatorToString(expr.operatorToken.kind) !== undefined) {
    if (!newAllocatedVars.has(expr.left.expression.text)) {
      mutableArrayVars.add(expr.left.expression.text);
    }
    if (inFunctionScope) functionScopeMutatedArrays.add(expr.left.expression.text);
  }
  // Detect element increment / decrement (arr[i]++ / arr[i]-- / ++arr[i] / --arr[i]).
  if ((ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr))
      && ts.isElementAccessExpression(expr.operand)
      && ts.isIdentifier(expr.operand.expression)
      && (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken)) {
    mutableArrayVars.add(expr.operand.expression.text);
    if (inFunctionScope) functionScopeMutatedArrays.add(expr.operand.expression.text);
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

// Null-prototype via setPrototypeOf below (a plain object literal inherits
// Object.prototype members — see the note at the setPrototypeOf call).
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
  // Overload-based members: the polyfills define BOTH std::string and
  // std::vector overloads of __tc_indexOf/__tc_includes, so the helper call
  // resolves correctly for either receiver type. (indexOf/includes used to be
  // gate-blocked on both sides — the prescan marks any `.includes` receiver a
  // mutable array, and the string gate then refused to lower it.)
  indexOf: (r, [a]) => `__tc_indexOf(${r}, ${a[0]})`,
  includes: (r, [a]) => `__tc_includes(${r}, ${a[0]})`,
};
// Null-prototype: a plain object literal inherits Object.prototype members, so
// a user call like `x.toString(...)` resolved `VECTOR_CALLBACK_METHOD_HELPERS
// ["toString"]` to the inherited Function (truthy!) and produced a method-call
// IR node whose callee was a FUNCTION — analysis then crashed on
// `callee.includes`. Stripping the prototype keeps every other lookup equal.
Object.setPrototypeOf(VECTOR_VALUE_METHOD_LOWERINGS, null);

// Callback-arg methods: map method name → helper callee. The receiver and all
// args (including the callback) become structured method-call args so the
// callback hoister can find and name them. `.sort()` with NO arg is a value
// method (`__tc_sort(recv)`), handled separately below. Null-prototype — see
// the comment on VECTOR_VALUE_METHOD_LOWERINGS (a plain object made
// `n.toString(...)` resolve to the inherited Object.prototype.toString).
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
Object.setPrototypeOf(VECTOR_CALLBACK_METHOD_HELPERS, null);

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
  // A template_string receiver is a ToString conversion. When it wraps a
  // NUMERIC value (`m.toString().padStart(2, "0")` — no-arg toString on a
  // number lowers to a template_string), the raw IR-side render emits the
  // bare number and the helper gets a double where it needs a std::string
  // (g++: "invalid initialization of const std::string& from const double").
  // Route numerics through the JS-repr helper; string-typed inners keep their
  // text.
  if (ir.kind === "template_string") {
    const inner = ir.expression as { kind?: string; value?: string };
    const innerIsStringy = inner?.kind === "string"
      || (inner?.kind === "identifier"
        && (() => {
          const t = getCurrentIrTypeScope()?.locals.get(String(inner.value))
            ?? getCurrentIrTypeScope()?.globals.get(String(inner.value));
          return t === "std::string" || t === "const char*" || t === "char*";
        })());
    if (!innerIsStringy) {
      return `__tc_numToStr_js(${renderExprAsText(ir.expression as never)})`;
    }
  }
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
  // ── push/pop/shift/unshift/reverse on NON-identifier receivers (a class
  // field: `this.data.shift()`, or an object record's field:
  // `current.laps.push(lap)`) ────────────────────────────────────────────────
  // The identifier branches below cover locals/globals (including the
  // StaticArray promotion prediction); a property-access receiver fell
  // through VERBATIM (`this->data.shift()` — std::vector has no shift
  // member). Rewrite when the receiver resolves to a plain std::vector (a
  // __tc_StaticArray DOES expose .push/.pop). Identifier receivers are
  // intentionally NOT handled here — their type can be stale (pre-promotion)
  // and the StaticArray prediction below owns them.
  if (ts.isPropertyAccessExpression(expr.expression)) {
    const paReceiver = expr.expression.expression;
    const paMethod = expr.expression.name.text;
    if (paMethod === "pop" || paMethod === "push" || paMethod === "shift" || paMethod === "unshift" || paMethod === "reverse") {
      // Resolve the receiver field's type: `this.field` via the class-field
      // maps, `obj.field` via the base's recorded type + the class IR's
      // field list (the base may be a struct VALUE or a pointer).
      let recvNodeType: string | undefined;
      if (ts.isPropertyAccessExpression(paReceiver) && paReceiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
        recvNodeType = getCurrentIrTypeScope()?.locals.get(`this->${paReceiver.name.text}`)
          ?? getCurrentIrTypeScope()?.classFields.get(`this->${paReceiver.name.text}`);
      } else if (ts.isPropertyAccessExpression(paReceiver) && ts.isIdentifier(paReceiver.expression)) {
        const baseType = getCurrentIrTypeScope()?.locals.get(paReceiver.expression.text)
          ?? getCurrentIrTypeScope()?.globals.get(paReceiver.expression.text);
        if (baseType) {
          const bareBase = parsedBareString(baseType);
          // The base may be a CLASS instance or an object-literal TYPE ALIAS
          // (a record struct). Resolve the field through whichever IR exists.
          const classField = topLevelClasses.get(bareBase)?.fields.find(f => f.name === paReceiver.name.text);
          const field = (classField?.cppType as string | undefined)
            ?? aliasStructFieldType(bareBase, paReceiver.name.text);
          if (field) {
            recvNodeType = field;
          }
        }
      }
      if (recvNodeType !== undefined && recvNodeType.startsWith("std::vector<")) {
        const recvIR = expressionToIR(paReceiver, sourceText, diagnostics, pointerVars);
        const recvText = renderExprAsText(recvIR);
        if (paMethod === "pop") {
          // __tc_pop (back + pop_back) VALUE-preserves the JS .pop() contract;
          // a bare pop_back() returns void and breaks `return arr.pop()` in a
          // class method (g++: "void value not ignored").
          return { kind: "raw", value: `__tc_pop(${recvText})` };
        }
        if (paMethod === "push") {
          const args = expr.arguments.map(a => renderExprAsText(expressionToIR(a, sourceText, diagnostics, pointerVars)));
          return { kind: "raw", value: `${recvText}.push_back(${args.join(", ")})` };
        }
        // shift/unshift/reverse ride the JS-semantics helpers (a bare
        // .erase(begin()) drops the removed element the TS caller may use).
        if (paMethod === "shift") {
          return { kind: "raw", value: `__tc_shift(${recvText})` };
        }
        if (paMethod === "reverse") {
          return { kind: "raw", value: `__tc_reverse(${recvText})` };
        }
        const unshiftArgs = expr.arguments.map(a => renderExprAsText(expressionToIR(a, sourceText, diagnostics, pointerVars)));
        return { kind: "raw", value: `__tc_unshift(${recvText}, ${unshiftArgs.join(", ")})` };
      }
    }
  }

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
      // The prediction must mirror the promotion's actual rules (variables.ts).
      // A module-level literal promotes only when its mutations were visible
      // at the module statement list's prescan — i.e. module-level call sites.
      // A mutation from inside a function body prescans AFTER the module list
      // processes, so that declaration stays std::vector; predicting
      // StaticArray for it emitted `.push` on a vector (g++: "no member named
      // 'push'"). A literal whose push sites are loop-nested routes to vector
      // as well.
      const vectorCapable0 = getContext().activeStrategy?.getStdLibSupport?.().hasVector ?? true;
      const moduleLiteralUnpromoted = moduleArrayLiteralVars.has(receiverName)
        && functionScopeMutatedArrays.has(receiverName);
      const willPromoteToStaticArray = promotesLiterals
        && arrayLiteralSizes.has(receiverName)
        && !moduleLiteralUnpromoted
        && !(unboundedArrayVars.has(receiverName) && vectorCapable0);
      const isStaticArrayType = typeIsStaticArray || willPromoteToStaticArray;
      if (isStaticArrayType) {
      // Structured method-call IR — NOT raw text. The strategy-level
      // applyStringMethodRewrites (a post-emit regex over rendered
      // expressions) cannot tell an array receiver from a string, so a plain
      // `a.indexOf(x)`/`a.lastIndexOf(x)`/`a.includes(x)` gets hijacked into
      // the string helpers (__tc_indexOf(__tc_str_ptr(a), x), strstr(a, 2)).
      // The parenthesized receiver breaks RECEIVER_PATTERN's match (the old
      // indexOf case did the same, for this reason).
      const asWrapperMethodCall = (method: string): ExpressionIR => ({
        kind: "method-call",
        callee: `(${receiverName}).${method}`,
        args: expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars)),
      });
      if (methodName === "pop") {
        return { kind: "raw", value: `${receiverName}.pop()` };
      }
      if (methodName === "push") {
        return asWrapperMethodCall("push");
      }
      if (methodName === "indexOf") {
        return asWrapperMethodCall("indexOf");
      }
      // .fill(v) / .fill(v, start, end) — the wrapper implements both arities
      // (returns *this so the TS return-the-receiver contract holds).
      if (methodName === "fill") {
        return asWrapperMethodCall("fill");
      }
      // Wrapper-native members: shift/unshift/includes/lastIndexOf. `join`
      // too — the wrapper folds its elements into a std::string (the one
      // string model), so the old "folded result exceeds the fixed-size
      // string model" diagnostic no longer applies to this receiver shape.
      if (methodName === "shift" || methodName === "unshift" || methodName === "includes" || methodName === "lastIndexOf" || methodName === "join") {
        return asWrapperMethodCall(methodName);
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

  // ---- .fill(v) on a std::vector receiver, NON-hosted target ----
  // Zephyr's minimal C++ lib has no __tc_fill helper and std::vector has no
  // fill member, so the hosted lowering below never runs and the call used to
  // emit verbatim (`bytes.fill(0)` — a compile error). Annotated `T[]`
  // variables DO lower to std::vector there, so lower fill to std::fill over
  // the clamped range and pull in <algorithm>.
  {
    const strat0 = getContext().activeStrategy;
    // Same hosted composite as the gate below — hasVector alone is not the
    // signal (Zephyr reports it truthfully with full libstdc++ yet takes
    // these non-hosted lowerings).
    const hosted0 = !strat0?.requiresLoopFunction()
      && strat0?.promotesArrayLiteralsToStaticArray?.() === false
      && (strat0?.getStdLibSupport?.().hasVector ?? true);
    if (!hosted0 && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "fill") {
      const receiverNode = expr.expression.expression;
      const receiverText = renderExprAsText(expressionToIR(receiverNode, sourceText, diagnostics, pointerVars));
      let receiverType: string | undefined;
      if (ts.isIdentifier(receiverNode)) {
        receiverType = getCurrentIrTypeScope()?.locals.get(receiverNode.text)
          ?? getCurrentIrTypeScope()?.globals.get(receiverNode.text);
      } else if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(receiverNode.name)) {
        receiverType = getCurrentIrTypeScope()?.locals.get(`this->${receiverNode.name.text}`);
      }
      const isVectorish = !!receiverType && /^std::vector</.test(receiverType);
      // A side-effecting receiver (a call) must not be evaluated 2-3 times in
      // the 3-arg range form — only lower side-effect-free lvalues there. The
      // 1-arg form names it once, matching the hosted helper.
      const isSimpleLvalue = /^[\w>.\-\[\]]+$/.test(receiverText) && !receiverText.includes("(");
      if (isVectorish && expr.arguments.length >= 1 && (expr.arguments.length === 1 || isSimpleLvalue)) {
        requiredIncludes.add("<algorithm>");
        const valueText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        if (expr.arguments.length >= 3) {
          const startText = renderExprAsText(expressionToIR(expr.arguments[1], sourceText, diagnostics, pointerVars));
          const endText = renderExprAsText(expressionToIR(expr.arguments[2], sourceText, diagnostics, pointerVars));
          const lenText = `static_cast<int>(${receiverText}.size())`;
          return {
            kind: "raw",
            value: `std::fill(${receiverText}.begin() + ((${startText}) < 0 ? 0 : (${startText})), ${receiverText}.begin() + ((${endText}) > ${lenText} ? ${lenText} : (${endText})), ${valueText})`,
          };
        }
        return { kind: "raw", value: `std::fill(${receiverText}.begin(), ${receiverText}.end(), ${valueText})` };
      }
    }
    // Array methods whose ONLY lowerings are the hosted __tc_* helpers.
    // On a StaticArray target (Zephyr/Arduino: T[] → __tc_StaticArray, no
    // STL containers in the runtime model) there is no lowering at all —
    // the call used to fall through as raw text and fail at g++ time
    // ("no member named 'join'") with no hint. Fail the transpile with a
    // targeted diagnostic instead, receiver-gated so a user class with a
    // same-named method is not flagged.
    const STATIC_ARRAY_TARGET_METHODS = new Set([
      "join", "filter", "map", "reduce", "find", "findIndex",
      "every", "some", "sort", "slice", "concat", "splice", "reverse",
    ]);
    // (split is NOT gated: under the one string model every target with
    // vectors lowers it to __tc_split, which returns std::vector<std::string>.)
    if (
      ts.isPropertyAccessExpression(expr.expression)
      && !hosted0
      && STATIC_ARRAY_TARGET_METHODS.has(expr.expression.name.text)
    ) {
      const methodName = expr.expression.name.text;
      const recvNode = expr.expression.expression;
      let receiverMatches = false;
      if (ts.isArrayLiteralExpression(recvNode)) {
        receiverMatches = true;
      } else if (ts.isIdentifier(recvNode)) {
        const vt = getCurrentIrTypeScope()?.locals.get(recvNode.text)
          ?? getCurrentIrTypeScope()?.globals.get(recvNode.text);
        if (vt) {
          const trimmed = vt.trim();
          // A STRING-typed receiver is never this gate's business, whatever
          // the prescan says: mutableArrayVars is SYNTACTIC (any receiver of
          // .indexOf/.lastIndexOf/.push/... is added with no type info), so a
          // string local that happens to call lastIndexOf — `t.lastIndexOf('*')`
          // before `t.slice(1, star)` — lands in the set and used to trip this
          // gate, emitting `0 /* array.slice unsupported */` for a plain string
          // slice. shouldLowerAsStringMethod guards the same poison on the
          // string side; this is the mirror guard on the array side. The
          // string-method path below (which runs later) owns these receivers.
          const isStringLikeType = trimmed === "std::string" || trimmed === "const char*" || trimmed === "char*";
          // A std::vector receiver on a vector-capable target is NOT an
          // error: the vector-receiver lowering below handles it natively
          // (annotated `T[]` declarations lower to std::vector on Zephyr too
          // — only array LITERALS become __tc_StaticArray there). Which
          // methods those are is DERIVED from the actual lowering tables —
          // VECTOR_VALUE_METHOD_LOWERINGS + VECTOR_CALLBACK_METHOD_HELPERS —
          // plus `push` (special-cased to push_back in the structural
          // section). The list used to be hand-copied here and omitted every
          // callback method, so `.sort(fn)` on a std::vector fired this gate
          // ("no lowering on this target") while the callback table happily
          // lowered it — the gate and the tables had drifted apart.
          const vectorHandled = parsedIsVector(trimmed)
            && (getContext().activeStrategy?.getStdLibSupport?.().hasVector ?? true)
            && (VECTOR_VALUE_METHOD_LOWERINGS[methodName] !== undefined
              || VECTOR_CALLBACK_METHOD_HELPERS[methodName] !== undefined
              || methodName === "push");
          const arrayish = !vectorHandled && !isStringLikeType && (parsedIsVector(trimmed) || parsedIsStaticArray(trimmed)
            || trimmed.endsWith("[]") || mutableArrayVars.has(recvNode.text)
            || activeCArrayVars.has(recvNode.text));
          receiverMatches = arrayish;
        }
      }
      if (receiverMatches) {
        const message = methodName === "join"
            ? `array.${methodName}() has no lowering on this target (the folded result exceeds the fixed-size string model) — emit the elements in a loop instead.`
            : `array.${methodName}() has no lowering on this target (no STL containers in the fixed-size array model) — replace it with an explicit loop over the elements.`;
        diagnostics.push(makeDiagnostic(
          sourceText,
          expr.pos,
          message,
          "error",
          `array-${methodName}-unsupported`,
        ));
        return { kind: "raw", value: `0 /* array.${methodName} unsupported */` };
      }
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
  // proxy for "hosted"), AND it actually lowers mutable arrays to std::vector
  // (promotesArrayLiteralsToStaticArray() false — hasVector alone is NOT the
  // right conjunct: Zephyr now truthfully reports hasVector (full libstdc++)
  // yet still lowers array literals to __tc_StaticArray; on that target a
  // user-class method named `push` must NOT be rewritten to .push_back).
  const strat = getContext().activeStrategy;
  // ── std::vector receivers on EVERY vector-capable target ────────────────
  // Annotated `T[]` declarations lower to std::vector on Zephyr as well (the
  // StaticArray promotion only rewrites array LITERALS; module-level mutated
  // arrays also miss the promotion for timing reasons — the function bodies
  // that prescan the pushes lower after the declaration). The hosted-only
  // gate below used to leave `.push`/`.includes`/`.indexOf` on those vectors
  // verbatim → g++ "no member named 'push'". Gate on the RECEIVER's resolved
  // C++ type instead of the target class: a std::vector receiver gets
  // push_back / the __tc_* vector helpers wherever vectors exist. The helpers
  // ship in the framework's vector polyfills (Zephyr: vector_methods).
  const vectorCapable = strat?.getStdLibSupport?.().hasVector ?? true;
  if (vectorCapable && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    const receiverNode = expr.expression.expression;
    let receiverType: string | undefined;
    if (ts.isIdentifier(receiverNode)) {
      receiverType = getCurrentIrTypeScope()?.locals.get(receiverNode.text)
        ?? getCurrentIrTypeScope()?.globals.get(receiverNode.text);
      // Hoisted function bodies lower BEFORE the module statements that
      // declare their receivers, so a module array's type is not yet in the
      // scope maps here. A module-level literal mutated from this function
      // stays std::vector (see the willPromoteToStaticArray reasoning above)
      // — treat that shape as authoritative when the scope lookup misses.
      if (receiverType === undefined
        && moduleArrayLiteralVars.has(receiverNode.text)
        && functionScopeMutatedArrays.has(receiverNode.text)) {
        receiverType = "std::vector<auto>";
      }
    } else if (ts.isPropertyAccessExpression(receiverNode)
      && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword
      && ts.isIdentifier(receiverNode.name)) {
      receiverType = getCurrentIrTypeScope()?.locals.get(`this->${receiverNode.name.text}`);
    }
    const isVectorReceiver = receiverType !== undefined
      && (parsedIsVector(receiverType.trim()) || receiverType === "std::vector<auto>");
    if (receiverNode.getText() === 's') console.error('DBG-VEC2: type=', receiverType, 'isVec=', isVectorReceiver);
    // Table-derived membership (same rule as the decline gate above): every
    // method with a lowering for std::vector receivers — value methods AND
    // callback methods. This block serves EVERY vector-capable target; the
    // hosted-only block below additionally covers non-identifier receivers
    // (inline array literals), which lower to std::vector only there.
    const hasVectorLowering = VECTOR_VALUE_METHOD_LOWERINGS[methodName] !== undefined
      || VECTOR_CALLBACK_METHOD_HELPERS[methodName] !== undefined
      || methodName === "push";
    if (isVectorReceiver && hasVectorLowering) {
      // Callback-arg methods FIRST: they must stay structured method-call IR
      // nodes (a raw node is opaque to the emit-time callback hoister, which
      // needs to name the lambda). Mirror of the hosted block's dispatch.
      const cbHelper = VECTOR_CALLBACK_METHOD_HELPERS[methodName];
      if (cbHelper && expr.arguments.length > 0 && !ts.isSpreadElement(expr.arguments[0])) {
        const cbReceiverIR = expressionToIR(receiverNode, sourceText, diagnostics, pointerVars);
        const cbArgIRs = expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars));
        return { kind: "method-call", callee: cbHelper, args: [cbReceiverIR, ...cbArgIRs] };
      }
      if (methodName === "sort" && expr.arguments.length === 0) {
        const receiverText0 = renderExprAsText(expressionToIR(receiverNode, sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `__tc_sort(${receiverText0})` };
      }
      if (methodName === "reduce" && expr.arguments.length === 1) {
        const receiverText0 = renderExprAsText(expressionToIR(receiverNode, sourceText, diagnostics, pointerVars));
        const cbText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
        return { kind: "raw", value: `__tc_reduce_no_init(${receiverText0}, ${cbText})` };
      }
      const receiverText = renderExprAsText(expressionToIR(receiverNode, sourceText, diagnostics, pointerVars));
      if (methodName === "push") {
        // JS push is variadic (`out.push(ESC, b ^ XOR)`) and returns the new
        // length. One arg lowers to push_back directly; several lower to a
        // comma expression that keeps the return contract (the last operand
        // is the new size, as number).
        const argsText = expr.arguments.map(arg => renderPushArgForElement(arg, receiverNode, sourceText, diagnostics, pointerVars));
        if (argsText.length === 0) {
          return { kind: "raw", value: `static_cast<int>(${receiverText}.size())` };
        }
        if (argsText.length === 1) {
          return { kind: "raw", value: `${receiverText}.push_back(${argsText[0]})` };
        }
        const pushes = argsText.map(a => `${receiverText}.push_back(${a})`).join(", ");
        return { kind: "raw", value: `(${pushes}, static_cast<int>(${receiverText}.size()))` };
      }
      if (methodName === "includes") {
        const argText = expr.arguments.length > 0
          ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
          : "";
        return { kind: "raw", value: `__tc_includes(${receiverText}, ${argText})` };
      }
      if (methodName === "join") {
        // `.join(sep)` folds the elements into one std::string — the one
        // string model made the old "exceeds the fixed-size string model"
        // objection stale. The helper ships in the framework's vector
        // polyfills (Zephyr: vector_methods; native: hosted-shim) and in
        // __tc_StaticArray's own join member for promoted literals.
        const joinSep = expr.arguments.length > 0
          ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
          : '""';
        return { kind: "raw", value: `__tc_join(${receiverText}, ${joinSep})` };
      }
      // JS mutators with JS return contracts (pop/shift return the removed
      // element, unshift the new length): a bare .pop_back() returns void and
      // std::vector has no shift/unshift/reverse members at all.
      if (methodName === "pop") {
        return { kind: "raw", value: `__tc_pop(${receiverText})` };
      }
      if (methodName === "shift") {
        return { kind: "raw", value: `__tc_shift(${receiverText})` };
      }
      if (methodName === "reverse") {
        return { kind: "raw", value: `__tc_reverse(${receiverText})` };
      }
      if (methodName === "unshift") {
        const unshiftArg = expr.arguments.length > 0
          ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
          : "";
        return { kind: "raw", value: `__tc_unshift(${receiverText}, ${unshiftArg})` };
      }
      // slice: JS value semantics — a fresh vector each call. The helpers
      // ship in the framework's vector polyfills (Zephyr: vector_methods;
      // native: hosted array_methods).
      if (methodName === "slice") {
        const sliceArgs = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)));
        if (expr.arguments.length >= 2) {
          return { kind: "raw", value: `__tc_slice2(${receiverText}, ${sliceArgs[0]}, ${sliceArgs[1]})` };
        }
        if (expr.arguments.length === 1) {
          return { kind: "raw", value: `__tc_slice1(${receiverText}, ${sliceArgs[0]})` };
        }
        return { kind: "raw", value: `std::vector(${receiverText})` };
      }
      const argText = expr.arguments.length > 0
        ? renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars))
        : "";
      return { kind: "raw", value: `__tc_indexOf(${receiverText}, ${argText})` };
    }
  }
  const isHostedTarget = !strat?.requiresLoopFunction()
    && (strat?.promotesArrayLiteralsToStaticArray?.() === false)
    && (strat?.getStdLibSupport?.().hasVector ?? true);
  if (isHostedTarget && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    // A receiver the prescan saw NEW-allocated is a user-class instance
    // (`const s = new Stack<number>()`): every `.method()` on it is a user
    // method — `.push` on a Stack must stay `s.push(...)`, never the vector
    // push_back (g++: "request for member 'push_back' ... pointer type").
    // Skip this whole hosted-array block for such receivers.
    if (ts.isIdentifier(expr.expression.expression) && newAllocatedVars.has(expr.expression.expression.text)) {
      return null;
    }
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
      return { kind: "method-call", callee: cbHelper, args: [receiverIR, ...argIRs] }
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
  }

  // ── String-method lowering (structural, EVERY target) ────────────────
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
  // NOT gated on isHostedTarget: the string helpers exist on every target
  // (hosted: std::string signatures; Zephyr/Arduino: const char*), and the
  // strategy-side regex fallback MANGLES non-identifier receivers on the
  // embedded targets — `c.nm.padEnd(7)` on a class-pointer member rewrote
  // to `c->__tc_padEnd_default(nm, 7)` (the regex captured `nm` as the
  // receiver and left the `c->` prefix), and `X[i].toLowerCase()` /
  // `fn(...).toUpperCase()` stayed verbatim. Structural rendering handles
  // every receiver shape on every target.
  //
  // Gate: only fire for a KNOWN string method whose receiver is NOT a known
  // array (the array paths above already handled array `indexOf`/`slice`/
  // etc.). For methods that exist on BOTH strings and arrays
  // (`indexOf`/`includes`/`startsWith`/`endsWith`/`slice`/`substring`), gate
  // on the receiver's resolved C++ type being string-like, so an array
  // `indexOf` is never mis-lowered to the string helper.
  if (ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    if (STRING_METHOD_NAMES.has(methodName)) {
      const receiverNode = expr.expression.expression;
      // Use renderArrayMethodReceiver so an INLINE array-literal receiver of an
      // ambiguous string/array method (`.join`, `.concat`, `.slice`, ...) is
      // type-qualified into `std::vector<ElemType>{...}` — the `__tc_*` helpers
      // are templates and a bare brace-init-list cannot drive deduction. A
      // genuine string receiver passes through unchanged. Demo #29 Finding D.
      let receiverText = renderArrayMethodReceiver(receiverNode, sourceText, diagnostics, pointerVars);
      // A variant-narrowed receiver (else-branch of a typeof guard over a
      // 2-arm variant) reads its active arm — the raw variant name passed to
      // the __tc_* string helper failed to convert (std::variant →
      // const std::string&).
      if (ts.isIdentifier(receiverNode)) {
        const narrow = (getContext() as unknown as { variantNarrowing?: Map<string, string> }).variantNarrowing;
        const arm = narrow?.get(receiverNode.text);
        if (arm) {
          receiverText = `std::get<${arm}>(${receiverNode.text})`;
        }
      }
      if (shouldLowerAsStringMethod(receiverNode, methodName)) {
        // const char* string targets: a receiver whose EMITTED C++ type is
        // std::string must convert to const char* for the target's helper
        // signatures. The discriminator is the strategy-normalized resolved
        // type: a `string` binding's own declaration normalizes to
        // const char* (so NO conversion — `(PRINTABLE).c_str()` on a char*
        // is itself a compile error), and a container ELEMENT type also
        // normalizes through the container rewrite (std::vector<string>
        // emits as std::vector<const char*> there, so elements need no
        // conversion either). What remains genuinely std::string on those
        // targets converts. Hosted targets keep std::string everywhere
        // (normalizeCppType is the identity) and never hit the wrap.
        const resolved = resolveReceiverCppType(receiverNode);
        const stratS = getContext().activeStrategy;
        const emittedStringType = resolved === undefined
          ? undefined
          : (stratS?.normalizeCppType?.(resolved) ?? resolved);
        if (emittedStringType === "std::string"
          && stratS?.normalizeCppType?.("std::string") === "const char*"
          && !receiverText.endsWith(".c_str()")) {
          receiverText = `(${receiverText}).c_str()`;
        }
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
// unambiguously string-only. `lastIndexOf` is ambiguous too — TS arrays
// have it, and treating it as string-only hijacked array receivers into
// `__tc_lastIndexOf` (a helper the embedded targets never define).
const AMBIGUOUS_STRING_METHODS = new Set(["indexOf", "includes", "lastIndexOf", "startsWith", "endsWith", "slice", "substring"]);

/**
 * Decide whether `receiver.methodName(...)` should lower as a STRING method
 * (→ `__tc_*` helper) rather than being left for the array path. Returns true
 * for unambiguously-string methods (toLowerCase, charAt, ...), and for the
 * ambiguous overlap methods only when the receiver's resolved C++ type is
 * string-like (`std::string`/`const char*`/`char*`). Known arrays
 * (`mutableArrayVars`/`activeCArrayVars`) are rejected UNLESS the receiver's
 * resolved type is string-like — the prescan marks any `.indexOf`/`.includes`
 * receiver an array (syntactic, no type info), which used to poison string
 * variables: `s.toUpperCase()` after an `s.indexOf(...)` stayed verbatim.
 */
function shouldLowerAsStringMethod(receiverNode: ts.Expression, methodName: string): boolean {
  // A resolved string-like type wins over the prescan's array presumption.
  if (!AMBIGUOUS_STRING_METHODS.has(methodName)) {
    // Unambiguously a string method (toLowerCase/trim/charAt/charCodeAt/...).
    return true;
  }
  const resolvedType = resolveReceiverCppType(receiverNode);
  const isStringType = resolvedType === "std::string" || resolvedType === "const char*" || resolvedType === "char*";
  if (ts.isIdentifier(receiverNode)) {
    if ((mutableArrayVars.has(receiverNode.text) || activeCArrayVars.has(receiverNode.text)) && !isStringType) {
      return false;
    }
  }
  // Ambiguous: decide by the receiver's resolved C++ type.
  return isStringType;
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
  // A string literal is a string — `"hello".indexOf("l")` used to fall through
  // the ambiguous-method gate (type unknown → rejected) and emit verbatim
  // `std::string("hello").indexOf(...)` / `.substring(...)`, which don't exist.
  if (ts.isStringLiteral(receiverNode) || ts.isNoSubstitutionTemplateLiteral(receiverNode)) {
    return "std::string";
  }
  if (ts.isPropertyAccessExpression(receiverNode) && receiverNode.expression.kind === ts.SyntaxKind.ThisKeyword) {
    // classFields is the authoritative view inside method bodies — without
    // the fallback a this->field receiver resolved unknown and ambiguous
    // methods (slice on a vector<string> field) mis-took the STRING path.
    return scope.locals.get(`this->${receiverNode.name.text}`)
      ?? scope.classFields.get(`this->${receiverNode.name.text}`);
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
  // An identifier.field receiver (`s.fields.slice(2)`): resolve the field's
  // type through the owning class's IR — without this arm the receiver
  // resolved unknown and ambiguous methods on it mis-took the STRING path.
  if (ts.isPropertyAccessExpression(receiverNode) && ts.isIdentifier(receiverNode.expression)) {
    const ownerType = scope.locals.get(receiverNode.expression.text) ?? scope.globals.get(receiverNode.expression.text);
    const ownerName = ownerType ? parsedBareString(ownerType) : undefined;
    const cls = ownerName !== undefined ? topLevelClasses.get(ownerName) : undefined;
    const field = cls?.fields.find(f => f.name === receiverNode.name.text);
    if (field) return field.cppType;
  }
  // A method-call receiver (`this.lastOf(k).slice(0, 12)`, `stats.render()...`):
  // resolve the receiver class (this → active class, identifier → scope type)
  // and read the method's DECLARED return type from the class IR. Without this
  // arm the call-result receiver resolved to undefined and ambiguous
  // string/array methods on it fell through verbatim (g++: "no member named
  // 'slice'").
  if (ts.isCallExpression(receiverNode) && ts.isPropertyAccessExpression(receiverNode.expression)) {
    const methodName = receiverNode.expression.name.text;
    const recv = receiverNode.expression.expression;
    let className: string | undefined;
    if (recv.kind === ts.SyntaxKind.ThisKeyword) {
      className = getActiveClassName();
    } else if (ts.isIdentifier(recv)) {
      const recvType = scope.locals.get(recv.text) ?? scope.globals.get(recv.text);
      if (recvType) className = parsedBareString(recvType);
    }
    if (className) {
      const cls = topLevelClasses.get(className) ?? hoistedNestedClasses.find(c => c.name === className);
      const method = cls?.methods.find(m => m.name === methodName);
      const declared = method?.returnType as string | undefined;
      if (declared && declared !== "auto" && declared !== "void") {
        return declared;
      }
    }
    return undefined;
  }
  return undefined;
}

/**
 * Field type of an OBJECT-LITERAL TYPE ALIAS struct (`type Session = { laps:
 * Lap[] }`) — the struct fields ride the alias node in the context snapshot
 * (set by build-ir's Phase 0c alias collection). Class instances resolve
 * through topLevelClasses; alias RECORDS resolve here. Returns undefined for
 * unknown names / non-struct aliases.
 */
function aliasStructFieldType(aliasName: string, fieldName: string): string | undefined {
  const aliasNode = typeAliasNodes.get(aliasName);
  if (aliasNode === undefined || !ts.isTypeLiteralNode(aliasNode as ts.TypeNode)) return undefined;
  const member = (aliasNode as ts.TypeLiteralNode).members
    .filter(ts.isPropertySignature)
    .find(m => ts.isIdentifier(m.name!) && (m.name as ts.Identifier).text === fieldName);
  if (!member || member.type === undefined) return undefined;
  return typeNodeToCppType(member.type, typeAliasNodes.snapshot());
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
  // startsWith: on a managed-std::string target, the rfind prefix test; on a
  // const char* string target (Zephyr/Arduino) `rfind` doesn't exist —
  // strncmp/strlen is the equivalent (and mirrors the strategy-side
  // applyStringMethodRewrites special).
  if (methodName === "startsWith" && argCount >= 1) {
    const stratS = getContext().activeStrategy;
    if (stratS?.normalizeCppType?.("std::string") === "const char*") {
      return `(strncmp(${receiver}, ${args[0]}, strlen(${args[0]})) == 0)`;
    }
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
