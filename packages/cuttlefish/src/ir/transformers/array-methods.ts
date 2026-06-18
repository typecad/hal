import ts from "typescript";
import { Diagnostic } from "../../types";
import { StatementIR, ExpressionIR } from "../../api";
import { arrayLiteralSizes, mutableArrayVars, activeCArrayVars, getContext } from "../build-ir-state";
import { getCurrentIrTypeScope } from "../symbol-types";
import { expressionToIR } from "../expression-to-ir";
import { renderExprAsText } from "../render-expr";
import { assignmentOperatorToString } from "./variables";

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
        return { kind: "raw", value: `${receiverName}.indexOf(${argsText})` };
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
  // and have no __tc_* polyfills). requiresLoopFunction() is false exactly on
  // hosted targets — the same set that ran the old native normalizeRawExpression.
  const isHostedTarget = !getContext().activeStrategy?.requiresLoopFunction();
  if (isHostedTarget && ts.isPropertyAccessExpression(expr.expression)) {
    const methodName = expr.expression.name.text;
    // `push` lowers to native push_back (matches the old
    // `${RECV}\.push(([^)]+)\)` → `$1.push_back($2)` regex).
    if (methodName === "push") {
      const receiverText = renderExprAsText(expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars));
      const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars))).join(", ");
      return { kind: "raw", value: `${receiverText}.push_back(${argsText})` };
    }
    // `sort()` with no arg and `reduce` with one arg have distinct helpers.
    if (methodName === "sort" && expr.arguments.length === 0) {
      const receiverText = renderExprAsText(expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars));
      return { kind: "raw", value: `__tc_sort(${receiverText})` };
    }
    if (methodName === "reduce" && expr.arguments.length === 1) {
      const receiverText = renderExprAsText(expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars));
      const cbText = renderExprAsText(expressionToIR(expr.arguments[0], sourceText, diagnostics, pointerVars));
      return { kind: "raw", value: `__tc_reduce_no_init(${receiverText}, ${cbText})` };
    }
    // Callback-arg methods: lower to a method-call IR node (NOT raw) so the
    // emit-time callback hoister (top-level-prep.ts collectCallbacks) can find
    // the structured callback arg in `args`, hoist it to a named _isr_N
    // function, and substitute the name. A raw node is opaque to the hoister.
    const cbHelper = VECTOR_CALLBACK_METHOD_HELPERS[methodName];
    if (cbHelper) {
      const receiverIR = expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars);
      const argIRs = expr.arguments.map(arg => expressionToIR(arg, sourceText, diagnostics, pointerVars));
      return { kind: "method-call", callee: cbHelper, args: [receiverIR, ...argIRs] };
    }
    // Value-arg methods: collapse to a raw helper call (no callbacks to hoist).
    const lowering = VECTOR_VALUE_METHOD_LOWERINGS[methodName];
    if (lowering) {
      const receiverText = renderExprAsText(expressionToIR(expr.expression.expression, sourceText, diagnostics, pointerVars));
      const argsText = expr.arguments.map(arg => renderExprAsText(expressionToIR(arg, sourceText, diagnostics, pointerVars)));
      const lowered = lowering(receiverText, argsText, expr.arguments.length);
      if (lowered !== null) {
        return { kind: "raw", value: lowered };
      }
    }
  }

  return null;
}
