import ts from "typescript";
import { ExpressionIR, HALOpIR } from "../../api/index.js";
import { requiredIncludes, registeredCallbacks, activeStringVars, TYPED_ARRAY_ELEMENT_MAP, getContext, floatVariables, halInstances, getCurrentBoardConstants, markHalOpResolved } from "../build-ir-state.js";
import { getCurrentIrTypeScope } from "../symbol-types.js";
import { renderExprAsText } from "../render-expr.js";
import { escapeCppKeyword, escapeCppStringLiteral } from "../../utils/strings.js";
import { HALInstance, halClassRegistry, halGlobalFunctions, HALMethodEntry } from "./hal-parser.js";
import { tryResolveSemanticCall, tryResolveBoardResolveArg, tryResolveCompoundSemanticReturn, resolveConcatPath } from "./hal-plugins.js";
import { cppTypeForHalOp } from "../../emit/utils/hal-op-cpp-type.js";

/** Escape C++ keywords in resolved text, but only when the text looks like a
 *  variable reference (not a literal like "false", "true", "42", or a string). */
export function maybeEscapeResolvedText(text: string): string {
  // Skip escaping for boolean literals, numeric literals, and string literals
  if (text === "true" || text === "false" || text === "null" || text === "undefined") return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  if (text.startsWith('"') || text.startsWith("'")) return text;
  return escapeCppKeyword(text);
}

/**
 * Strip a leading `.c_str()` from the literal text that follows a template span
 * when the resolved value is a C++ string literal (e.g. `"label"`).
 *
 * HAL authors write `${param}.c_str()` to convert a `String`/`std::string`
 * variable to `const char*` for C APIs. That is correct when `param` is a
 * variable (renders as `myVar` → `myVar.c_str()`). But when `param` is a string
 * literal it renders as `"label"`, and `"label".c_str()` is invalid C++ — a
 * string literal has no `.c_str()` member. This drops the conversion in that
 * case so `"label".c_str()` becomes just `"label"`, while leaving the variable
 * path untouched.
 */
export function stripCStrAfterStringLiteral(followingLiteralText: string, resolvedValue: string): string {
  if (resolvedValue.startsWith('"') && followingLiteralText.startsWith(".c_str()")) {
    return followingLiteralText.slice(".c_str()".length);
  }
  return followingLiteralText;
}

/** Map a TypeScript PrefixUnaryExpression operator SyntaxKind to C++ text. */
function prefixOperatorText(operator: ts.SyntaxKind): string {
  switch (operator) {
    case ts.SyntaxKind.ExclamationToken: return "!";
    case ts.SyntaxKind.PlusToken: return "+";
    case ts.SyntaxKind.MinusToken: return "-";
    case ts.SyntaxKind.TildeToken: return "~";
    case ts.SyntaxKind.PlusPlusToken: return "++";
    case ts.SyntaxKind.MinusMinusToken: return "--";
    default: return "";
  }
}

/**
 * Inline a `this.<method>()` getter call used inside a compound expression
 * (e.g. `!this.read()` in InputPin.isLow()). The InputPin boolean-query
 * methods all reduce to a semantic read over `this._pin`; mapping them here
 * keeps `this` out of the emitted free function. Returns null if the method
 * is not a recognized inlinable getter.
 */
function inlineThisGetterCall(methodName: string, pin: string, strategy: import("../../api/shared/index.js").PlatformStrategy | null): string | null {
  switch (methodName) {
    case "read":
    case "isHigh":
    case "isLow": {
      // Output-pin state tracking: when the receiver is a tracked OUTPUT pin,
      // lower to the tracked level (constant when statically known, shadow
      // variable otherwise) instead of a hardware read. Reading back a
      // direction-only output is not portable (e.g. Zephyr).
      if (methodName === "read") return strategy?.readDigitalPin?.(pin) ?? `digitalRead(${pin})`;
      if (methodName === "isHigh") return strategy?.readDigitalPin?.(pin) ?? `digitalRead(${pin})`;
      return strategy?.readDigitalPin ? `(!${strategy.readDigitalPin(pin)})` : `(!digitalRead(${pin}))`;
    }
    case "readAnalog":
      return strategy?.readAnalogPin?.(pin) ?? `analogRead(${pin})`;
    default:
      return null;
  }
}

/** Resolve an arbitrary expression to its text form, with this/param substitution. */
export function resolveExpressionText(
  expr: ts.Expression,
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  paramDefaults?: Map<string, string>,
): string | null {
  // this._field → look up in instance
  // OtherInstance._field → look up in tracked halInstances (cross-instance reference)
  if (ts.isPropertyAccessExpression(expr)) {
    const isThis = expr.expression.kind === ts.SyntaxKind.ThisKeyword
      || (ts.isIdentifier(expr.expression) && expr.expression.text === "this")
      || expr.expression.getText() === "this";
    if (isThis) {
      const fieldName = expr.name.text;
      const val = instance.fieldValues.get(fieldName) ?? instance.fieldValues.get(fieldName.startsWith("_") ? fieldName.slice(1) : "_" + fieldName);
      if (val !== undefined && val !== null) return val;
      
      // Fallback: try to see if it's a known field that should be mapped
      if (fieldName === "_pin" && instance.fieldValues.has("pin")) return instance.fieldValues.get("pin")!;
      if (fieldName === "_bus" && instance.fieldValues.has("bus")) return instance.fieldValues.get("bus")!;

      return `this->${fieldName}`;
    }
    // Cross-instance field reference: e.g. ADC._reference → look up tracked instance
    if (ts.isIdentifier(expr.expression)) {
      let crossInst = halInstances.get(expr.expression.text);
      // Fall back to bare-name defaults if not yet cached
      if (!crossInst && expr.expression.text === "ADC") {
        crossInst = { className: "ADCClass", fieldValues: new Map([["_reference", "DEFAULT"]]) };
      }
      if (crossInst) {
        const val = crossInst.fieldValues.get(expr.name.text);
        if (val !== undefined) return val;
      }
    }
    const obj = resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
    if (obj === null) return null;
    return `${obj}.${expr.name.text}`;
  }

  // Identifier → parameter or constant
  if (ts.isIdentifier(expr)) {
    const paramIdx = paramNames.indexOf(expr.text);
    if (paramIdx !== -1) {
      if (paramIdx < callArgTexts.length) {
        const isSpread = expr.text === instance._spreadParamName;
        if (isSpread) {
          const spreadArgs = callArgTexts.slice(paramIdx);
          return spreadArgs.join(", ");
        }
        return maybeEscapeResolvedText(callArgTexts[paramIdx]);
      } else if (paramDefaults?.has(expr.text)) {
        return maybeEscapeResolvedText(paramDefaults.get(expr.text)!);
      }
      // Optional parameter that was omitted at the call site and has no
      // default: its runtime value is `undefined`. Returning the literal name
      // would leak a dangling identifier into the emitted C++ (e.g.
      // `asOutput(initial?: ...)` referenced as `(initial) ? HIGH : LOW`).
      return "undefined";
    }
    return escapeCppKeyword(expr.text);
  }

  if (ts.isNumericLiteral(expr)) return expr.text;
  // Escape the DECODED text back to a valid C++ literal — expr.text holds
  // real control chars (a "\n" argument decodes to a newline), and a raw
  // newline inside a C string literal is an unterminated literal that
  // corrupts the rest of the file. Same helper every other renderer uses.
  if (ts.isStringLiteral(expr)) return `"${escapeCppStringLiteral(expr.text)}"`;

  // Call expression (e.g., digitalRead(this._pin), board("path"))
  if (ts.isCallExpression(expr)) {
    // callback(param) → return the patched placeholder text
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "callback") {
      const cbArg = expr.arguments[0];
      if (cbArg && ts.isIdentifier(cbArg)) {
        const paramIdx = paramNames.indexOf(cbArg.text);
        if (paramIdx !== -1 && paramIdx < callArgTexts.length) {
          return callArgTexts[paramIdx];
        }
      }
      return null;
    }

    // String(x) → return resolved text of x (identity in compile-time string context)
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "String") {
      const inner = expr.arguments[0];
      if (inner) {
        return resolveExpressionText(inner, instance, paramNames, callArgTexts, paramDefaults);
      }
      return "";
    }

    // board("path") → look up in current board constants
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "board") {
      const pathArg = expr.arguments[0];
      // Static string literal path: board("peripherals.adc.0.resolution")
      if (pathArg && ts.isStringLiteral(pathArg)) {
        const bc = getCurrentBoardConstants();
        if (bc) {
          const val = bc.get(pathArg.text);
          if (val !== undefined) return String(val);
        }
      }
      // Dynamic path via string concat or template literal:
      // board("prefix." + this._field) / board(`prefix.${this._field}`)
      if (pathArg && (ts.isBinaryExpression(pathArg) || ts.isTemplateExpression(pathArg) || ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg))) {
        const fullPath = resolveConcatPath(pathArg, instance, paramNames, callArgTexts, paramDefaults);
        if (fullPath !== null) {
          const bc = getCurrentBoardConstants();
          if (bc) {
            const val = bc.get(fullPath);
            if (val !== undefined) return String(val);
          }
        }
      }
      return null;
    }

    const callee = resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
    if (callee === null) return null;
    const args = expr.arguments.map(arg => resolveExpressionText(arg, instance, paramNames, callArgTexts, paramDefaults));
    if (args.some(a => a === null)) return null;

    // this.<method>() — a HAL method called on the same instance inside a
    // compound expression (e.g. InputPin.isLow() returns `!this.read()`).
    // Inline the known InputPin boolean-query getters over the resolved pin
    // so `this` never leaks into the emitted free function.
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const isThisAccess = expr.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        || (ts.isIdentifier(expr.expression.expression) && expr.expression.expression.text === "this")
        || expr.expression.expression.getText() === "this";
      if (isThisAccess) {
        const methodName = expr.expression.name.text;
        const pin = instance.fieldValues.get("_pin") ?? instance.fieldValues.get("pin");
        if (pin !== undefined) {
          const inlined = inlineThisGetterCall(methodName, pin, getContext().activeStrategy);
          if (inlined !== null) return inlined;
        }
      }
    }

    return `${callee}(${args.join(", ")})`;
  }

  // Binary expression
  if (ts.isBinaryExpression(expr)) {
    const left = resolveExpressionText(expr.left, instance, paramNames, callArgTexts, paramDefaults);
    const right = resolveExpressionText(expr.right, instance, paramNames, callArgTexts, paramDefaults);
    if (left === null || right === null) return null;
    
    let op = expr.operatorToken.getText();
    if (op === "===") op = "==";
    else if (op === "!==") op = "!=";
    else if (op === "??") {
      // If the left side is a literal expression (true/false/number/string),
      // it can never be undefined so use it directly
      if (expr.left.kind === ts.SyntaxKind.TrueKeyword || expr.left.kind === ts.SyntaxKind.FalseKeyword || 
          ts.isNumericLiteral(expr.left) || ts.isStringLiteral(expr.left)) {
        return left;
      }
      // If the left side is an identifier whose resolved text matches its source,
      // it means the parameter was not provided by the caller, so use the right side
      if (ts.isIdentifier(expr.left) && left === expr.left.text) {
        return right;
      }
      // If the left side resolved to a recognized literal (true, false, or number),
      // the parameter was provided with a concrete value, not undefined.
      if (left === "true" || left === "false" || /^-?\d+(\.\d+)?$/.test(left)) {
        return left;
      }
      // Use a more concise ternary for C++
      return `(${left} != CUTTLEFISH_UNDEFINED ? ${left} : ${right})`;
    }
    
    return `${left} ${op} ${right}`;
  }

  // Parenthesized expression: (expr) → unwrap to inner expression
  if (ts.isParenthesizedExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
  }

  // Type assertion: this as any → unwrap to inner expression
  if (ts.isAsExpression(expr)) {
    return resolveExpressionText(expr.expression, instance, paramNames, callArgTexts, paramDefaults);
  }

  // Template expression: `text ${expr} more text`
  if (ts.isTemplateExpression(expr)) {
    let result = expr.head.text;
    for (const span of expr.templateSpans) {
      const resolved = resolveExpressionText(span.expression, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved === null) return null;
      result += resolved + stripCStrAfterStringLiteral(span.literal.text, resolved);
    }
    return result;
  }

  // No-substitution template literal: `text`
  if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }

  // Prefix unary expression (e.g. `!this.read()`): resolve the operand and
  // re-apply the operator. Without this, `!this.read()` falls through to the
  // raw getText() fallback and leaks `this` into a free function.
  if (ts.isPrefixUnaryExpression(expr)) {
    const operand = resolveExpressionText(expr.operand, instance, paramNames, callArgTexts, paramDefaults);
    if (operand === null) return null;
    const op = prefixOperatorText(expr.operator);
    return `${op}${operand}`;
  }

  return expr.getText ? expr.getText() : null;
}

/** Semantic HAL helpers whose callbacks run in true ISR context (need IRAM_ATTR).
 *  WiFi event handlers, timers, setInterval, etc. use callback() too but run in
 *  a task / event loop — marking those as ISRs puts printf in IRAM and, on
 *  ESP-IDF, trips -Werror=attributes when IRAM_ATTR's __COUNTER__ disagrees
 *  between forward declaration and definition. */
const ISR_CALLBACK_SEMANTIC_FNS = new Set([
  "interruptAttachFlags",
]);

/** True when a HAL semantic call name wraps a GPIO/hardware ISR callback. */
export function semanticCallUsesIsrCallback(fnName: string): boolean {
  return ISR_CALLBACK_SEMANTIC_FNS.has(fnName);
}

/** Scan an expression AST for callback() calls, extract callback IR from callArgs,
 *  register them, and patch callArgTexts with placeholder names.
 *  @param isInterruptHandler — only true for GPIO interrupt attach paths. */
export function extractAndRegisterCallbacks(
  expr: ts.Expression,
  paramNames: string[],
  callArgs: ExpressionIR[],
  callArgTexts: string[],
  isInterruptHandler: boolean = false,
): void {
  function scan(node: ts.Expression): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "callback") {
      const cbArg = node.arguments[0];
      if (cbArg && ts.isIdentifier(cbArg)) {
        const paramIdx = paramNames.indexOf(cbArg.text);
        if (paramIdx !== -1 && paramIdx < callArgs.length) {
          const callbackIR = callArgs[paramIdx];
          if (callbackIR.kind === "callback" || callbackIR.kind === "lambda") {
            const placeholder = `__CALLBACK_${getContext().callbackPlaceholderCounter++}__`;
            const normalized: ExpressionIR & { kind: "callback" } = callbackIR.kind === "lambda"
              ? {
                  kind: "callback",
                  params: callbackIR.params.map((p) => p.name),
                  statements: callbackIR.body,
                  ...(callbackIR.returnType && callbackIR.returnType !== "void" ? { returnType: callbackIR.returnType } : {}),
                  ...(callbackIR.params ? { typedParams: callbackIR.params.map((p: any) => ({ name: p.name, cppType: p.cppType })).filter((p: any) => p.cppType && p.cppType !== "void") } : {}),
                  sourceSpan: callbackIR.body[0]?.sourceSpan ?? {
                    filePath: "",
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 0,
                    startOffset: 0,
                    endOffset: 0,
                  },
                  ...(isInterruptHandler ? { isInterruptHandler: true } : {}),
                }
              : callbackIR;
            if (isInterruptHandler) {
              normalized.isInterruptHandler = true;
            }
            registeredCallbacks.push({ placeholderName: placeholder, callbackIR: normalized });
            callArgTexts[paramIdx] = placeholder;
          }
        }
      }
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        scan(span.expression);
      }
    }
  }
  scan(expr);
}

/** Process a HAL method body, resolving emit()/include()/semantic calls.
 *  Returns { emitLines, halOps, returnValue, returnClassName } or null if unresolvable.
 *
 *  `emitLines` contains legacy raw C++ strings (from `emit()` calls).
 *  `halOps` contains structured HALOpIR nodes (from semantic function calls like
 *  `gpioWrite()`, `i2cBegin()`, etc.).
 *
 *  During migration both can coexist; consumers should prefer `halOps` when present. */
export function processHALMethodBody(
  instance: HALInstance,
  methodName: string,
  callArgs: ExpressionIR[],
): { emitLines: string[]; halOps: HALOpIR[]; returnValue?: string; returnClassName?: string } | null {
  let methodEntry: HALMethodEntry | undefined;

  if (instance.className) {
    const classEntry = halClassRegistry.get(instance.className);
    if (!classEntry) return null;

    methodEntry = classEntry.methods.get(methodName);

    // Fallback: search other HAL classes for the method (e.g., Pin instance calling InputPin.onFalling)
    if (!methodEntry) {
      for (const [, entry] of halClassRegistry) {
        const found = entry.methods.get(methodName);
        if (found && found.methodNode.body) {
          methodEntry = found;
          break;
        }
      }
    }
  } else {
    methodEntry = halGlobalFunctions.get(methodName);
  }

  if (!methodEntry || !methodEntry.methodNode.body) return null;

  const paramNames = methodEntry.paramNames;
  const spreadParamName = methodEntry.spreadParamName;
  const callArgTexts = callArgs.map(a => renderExprAsText(a));
  
  instance._spreadParamName = spreadParamName;
  const paramDefaults = methodEntry.paramDefaults;

  const body = methodEntry.methodNode.body;

  const emitLines: string[] = [];
  const halOps: HALOpIR[] = [];

  // For string_concat args (template literals), generate snprintf instead of
  // C++ + concatenation which is invalid for char* on Arduino.
  for (let i = 0; i < callArgs.length; i++) {
    const arg = callArgs[i];
    if (arg.kind === "string_concat" && arg.parts.some(p => p.kind !== "string")) {
      const snprintf = buildSnprintfFromConcat(arg);
      if (snprintf) {
        emitLines.push(...snprintf.lines);
        callArgTexts[i] = snprintf.bufferName;
      }
    }
  }
  let returnValue: string | undefined;

  for (const stmt of body.statements) {
    // this._field = param — track field updates on the instance
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isBinaryExpression(stmt.expression) &&
      stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = stmt.expression.left;
      const right = stmt.expression.right;
      if (
        ts.isPropertyAccessExpression(left) &&
        (left.expression.kind === ts.SyntaxKind.ThisKeyword ||
          (ts.isIdentifier(left.expression) && left.expression.text === "this"))
      ) {
        const fieldName = left.name.text;
        const resolved = resolveExpressionText(right, instance, paramNames, callArgTexts, paramDefaults);
        if (resolved !== null) {
          instance.fieldValues.set(fieldName, resolved);
        }
      }
    }

    // emit(...) call or semantic HAL function call
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;

      // ── Board resolve: pure lookup, no side effects — skip ──
      if (ts.isIdentifier(call.expression) && call.expression.text === "boardResolve") {
        continue;
      }

      // ── Semantic HAL function calls (gpioWrite, i2cBegin, etc.) ──
      if (ts.isIdentifier(call.expression)) {
        // Extract callbacks from semantic call arguments and patch callArgTexts
        // with placeholder names before resolving (mirrors the emit() path).
        const isIsr = semanticCallUsesIsrCallback(call.expression.text);
        for (const arg of call.arguments) {
          extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts, isIsr);
        }

        const semanticOp = tryResolveSemanticCall(
          call.expression.text,
          call.arguments,
          instance,
          paramNames,
          callArgTexts,
          paramDefaults,
          callArgs,
        );
        if (semanticOp) {
          halOps.push(semanticOp);
          continue;
        }
      }

      // include(...) call
      if (ts.isIdentifier(call.expression) && call.expression.text === "include") {
        const firstArg = call.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          requiredIncludes.add(firstArg.text);
        }
        continue;
      }
    }

    // R4: if statement with compile-time condition evaluation
    if (ts.isIfStatement(stmt)) {
      let conditionTrue = true; // default: process then-branch
      const cond = stmt.expression;
      if (cond && ts.isBinaryExpression(cond)) {
        const left = resolveExpressionText(cond.left, instance, paramNames, callArgTexts, paramDefaults);
        const right = resolveExpressionText(cond.right, instance, paramNames, callArgTexts, paramDefaults);
        if (left !== null && right !== null) {
          const op = cond.operatorToken.kind;
          if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
            conditionTrue = left === right;
          } else if (op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
            conditionTrue = left !== right;
          }
        }
      }

      if (conditionTrue && stmt.thenStatement) {
        const returnRef = returnValue !== undefined ? undefined : { value: "" };
        processStatementList(
          ts.isBlock(stmt.thenStatement) ? (stmt.thenStatement as ts.Block).statements : [stmt.thenStatement as ts.Statement],
          instance, paramNames, callArgTexts, emitLines, halOps, callArgs, paramDefaults, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      if (!conditionTrue && stmt.elseStatement) {
        const returnRef = returnValue !== undefined ? undefined : { value: "" };
        processStatementList(
          ts.isBlock(stmt.elseStatement) ? (stmt.elseStatement as ts.Block).statements : [stmt.elseStatement as ts.Statement],
          instance, paramNames, callArgTexts, emitLines, halOps, callArgs, paramDefaults, returnRef,
        );
        if (returnRef && returnRef.value) returnValue = returnRef.value;
      }
      continue;
    }

    // R2: return expr — check for semantic call first, then fall back to resolveExpressionText
    if (ts.isReturnStatement(stmt) && stmt.expression && returnValue === undefined) {
      const retExpr = stmt.expression;

      // ── Board resolve: constant-fold via board constants ──
      if (ts.isCallExpression(retExpr) && ts.isIdentifier(retExpr.expression) && retExpr.expression.text === "boardResolve") {
        const resolved = tryResolveBoardResolveArg(retExpr.arguments, instance, paramNames, callArgTexts, paramDefaults);
        if (resolved !== null) {
          const bc = getCurrentBoardConstants();
          const val = bc?.get(resolved);
          if (val !== undefined) {
            returnValue = String(val);
            continue;
          }
        }
      }

      let actualRetExpr: ts.Expression = retExpr;
      while (ts.isAsExpression(actualRetExpr) || ts.isParenthesizedExpression(actualRetExpr)) {
        actualRetExpr = actualRetExpr.expression;
      }
      if (ts.isCallExpression(actualRetExpr) && ts.isIdentifier(actualRetExpr.expression)) {
        const isIsr = semanticCallUsesIsrCallback(actualRetExpr.expression.text);
        for (const arg of actualRetExpr.arguments) {
          extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts, isIsr);
        }
        const semanticOp = tryResolveSemanticCall(
          actualRetExpr.expression.text,
          actualRetExpr.arguments,
          instance, paramNames, callArgTexts, paramDefaults,
          callArgs,
        );
        if (semanticOp) {
          halOps.push(semanticOp);
          returnValue = "__hal_op_return__";
          continue;
        }
      }
      // Try to resolve semantic calls within compound expressions (e.g., gpioRead(pin) === HIGH)
      const compoundResult = tryResolveCompoundSemanticReturn(retExpr, instance, paramNames, callArgTexts, paramDefaults, halOps, callArgs);
      if (compoundResult !== null) {
        returnValue = compoundResult;
        continue;
      }

      // Handle: return new TypedArray(count) — mark as C array allocation
      if (ts.isNewExpression(retExpr) && ts.isIdentifier(retExpr.expression)) {
        const ctorName = retExpr.expression.text;
        const elementType = TYPED_ARRAY_ELEMENT_MAP?.[ctorName];
        if (elementType) {
          const sizeArg = retExpr.arguments?.[0];
          if (sizeArg) {
            const size = resolveExpressionText(sizeArg, instance, paramNames, callArgTexts, paramDefaults);
            if (size !== null) {
              returnValue = `__TYPED_ARRAY__:${elementType}:${size}`;
              continue;
            }
          }
        }
      }

      // Fall back to expression text resolution
      const resolved = resolveExpressionText(retExpr, instance, paramNames, callArgTexts, paramDefaults);
      if (resolved !== null) {
        returnValue = resolved.replace(/===/g, "==").replace(/!==/g, "!=");
      }
    }
  }

  // Demo #33 Finding D — value-returning HAL methods encode their C++ return
  // as a rawCpp emitLine/halOp of the form `return <expr>;` (e.g.
  // Preferences.getInt → `return Preferences.getInt(k, d);`), while the TS
  // method body's own `return 0;` / `return "";` is just a type-checking
  // fallback. Without this, var-init context (`const v = Preferences.getInt(...)`)
  // captured the TS fallback (0) instead of the real C++ value, so the
  // roundtrip returned the default. When the trailing halOp is a `return X;`
  // raw op, hoist X into returnValue so both statement and expression/var-init
  // contexts use the real C++ expression.
  if (halOps.length > 0) {
    const lastOp = halOps[halOps.length - 1];
    if (lastOp.operation === "raw" && typeof lastOp.code === "string") {
      const m = lastOp.code.match(/^\s*return\s+([\s\S]+?);\s*$/);
      if (m) {
        returnValue = m[1].trim();
        // Drop the now-redundant raw op so it isn't emitted as a stray
        // statement alongside the value capture.
        halOps.pop();
        emitLines.length = 0;
      }
    }
  }

  // Auto-passthrough for stub methods: if no emit() calls and the return is a literal
  // (e.g., return 0), construct the C++ expression as <objectName>.<method>(<args>).
  // Skip for Pin classes since Pin methods are typically lowered to standalone C calls (digitalRead/Write).
  if (emitLines.length === 0 && isLiteralReturnValue(returnValue)
      && instance.className !== "Pin"
      && instance.className !== "OutputPin"
      && instance.className !== "InputPin") {
    const cppObj = resolveCppObjectName(instance);
    if (cppObj) {
      const argsStr = callArgTexts.join(", ");
      return { emitLines: [], halOps: [], returnValue: `${cppObj}.${methodName}(${argsStr})` };
    }
  }

  // Return null if nothing useful was resolved, allowing inline fallbacks to kick in
  if (emitLines.length === 0 && halOps.length === 0 && returnValue === undefined) {
    // take()/release() are intentional no-ops (ownership is compile-time only).
    if (methodName === "take" || methodName === "release") {
      return { emitLines: [], halOps: [] };
    }
    return null;
  }

  // Extract return type annotation to support type-narrowed pattern
  // (e.g., Pin.asOutput(): OutputPin → returnClassName = "OutputPin")
  let returnClassName: string | undefined;
  const returnType = methodEntry.methodNode.type;
  if (returnType && ts.isTypeReferenceNode(returnType) && ts.isIdentifier(returnType.typeName)) {
    const name = returnType.typeName.text;
    if (halClassRegistry.has(name) && name !== instance.className) {
      returnClassName = name;
    }
  }

  return { emitLines, halOps, returnValue, returnClassName };
}

/** Check if a resolved C++ value string is a simple literal (for stub detection). */
export function isLiteralReturnValue(val: string | undefined): boolean {
  if (val === undefined) return false;
  return val === "0" || val === "true" || val === "false" || val === "''" || val === '""';
}

/** Resolve the C++ object name from a HAL instance's constructor field values. */
export function resolveCppObjectName(instance: HALInstance): string | null {
  const fieldMap = halClassRegistry.get(instance.className)?.ctorFieldMap;
  if (!fieldMap) return null;

  // Get the first field value from the instance that matches a constructor field
  for (const [fieldName] of fieldMap) {
    const val = instance.fieldValues.get(fieldName);
    if (val) return val;
  }
  return null;
}

/** Process a list of statements for emit/include/semantic calls/return. */
export function processStatementList(
  stmts: readonly ts.Statement[],
  instance: HALInstance,
  paramNames: string[],
  callArgTexts: string[],
  emitLines: string[],
  halOps: HALOpIR[],
  callArgs: ExpressionIR[],
  paramDefaults: Map<string, string>,
  returnExpr?: { value: string },
): void {
  for (const stmt of stmts) {
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (ts.isIdentifier(call.expression)) {
        if (call.expression.text === "include") {
          const firstArg = call.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            requiredIncludes.add(firstArg.text);
          }
        } else {
          // R3: Try semantic HAL function call
          const isIsr = semanticCallUsesIsrCallback(call.expression.text);
          for (const arg of call.arguments) {
            extractAndRegisterCallbacks(arg, paramNames, callArgs, callArgTexts, isIsr);
          }
          const semanticOp = tryResolveSemanticCall(
            call.expression.text, call.arguments,
            instance, paramNames, callArgTexts, paramDefaults,
            callArgs,
          );
          if (semanticOp) {
            halOps.push(semanticOp);
          }
        }
      }
    }
  }
}

/** Reset resolver state (called between builds). */
export function resetHALResolver(): void {
  halInstances.clear();
  floatVariables.clear();
  getContext().callbackPlaceholderCounter = 0;
  getContext().snprintfCounter = 0;
  // Reset the BLE characteristic counter so each file's GATT table starts at
  // index 0. Without this, a second transpile in one process would continue
  // from the previous file's counter and emit offset indices.
  getContext().bleCharCounter = 0;
}

/** Resolve a hal-expr IR node to its C++ text using the active strategy. */
export function setActiveStrategy(strategy: import("../../api/shared/index.js").PlatformStrategy | null): void {
  getContext().activeStrategy = strategy;
}

export function resolveHALExprToText(expr: Extract<import("../../api/shared/index.js").ExpressionIR, { kind: "hal-expr" }>): string | null {
  const strategy = getContext().activeStrategy;
  if (!strategy?.resolveHALOperation) return null;
  const resolved = strategy.resolveHALOperation(expr.operation);
  if (resolved) {
    // The op may never exist as an IR node (its text is baked into the
    // calling method's emit lines), so record it for program-analysis's
    // peripheral usage flags.
    markHalOpResolved(expr.operation.operation);
    if (resolved.expression) return resolved.expression;
    if (resolved.code) return resolved.code.replace(/;\s*$/, "");
  }
  return null;
}

export function registerFloatVariable(name: string): void {
  floatVariables.add(name);
}

/** Build snprintf prelude lines from a string_concat expression.
 *  Returns { lines, bufferName } or null if the expression can't be formatted. */

/** True when a binary IR expression touches a known float variable on either
 *  side (recursively) — its rendered C++ is double-valued. */
function binaryTouchesFloatVar(expr: { kind: string; left?: unknown; right?: unknown }): boolean {
  for (const side of [expr.left, expr.right]) {
    if (!side || typeof side !== "object") continue;
    const s = side as { kind: string; value?: unknown; left?: unknown; right?: unknown };
    if (s.kind === "identifier" && typeof s.value === "string" && floatVariables.has(s.value)) return true;
    if (s.kind === "binary" && binaryTouchesFloatVar(s as never)) return true;
  }
  return false;
}

export function buildSnprintfFromConcat(
  expr: Extract<ExpressionIR, { kind: "string_concat" }>,
): { lines: string[]; bufferName: string } | null {
  let formatString = "";
  const args: string[] = [];
  let estimatedLength = 1;
  const prelude: string[] = [];

  requiredIncludes.add("<stdio.h>");

  for (const part of expr.parts) {
    const text = renderExprAsText(part);
    if (part.kind === "string") {
      // Escape % → %% first (a bare % in the format string starts a
      // conversion — a literal '%RH' becomes the unknown-conversion 'R'),
      // then the C-literal escapes.
      formatString += text.slice(1, -1).replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      estimatedLength += part.value.length;
    } else if (part.kind === "number") {
      const isFloat = part.cppType === "float" || part.cppType === "double" || !Number.isInteger(part.value);
      if (isFloat) {
        // %g formats the double literal directly — portable (Zephyr's
        // cbprintf turns on FP support when it sees a float specifier);
        // dtostrf is AVR-only and fails to compile elsewhere (same reasoning
        // as the float-VARIABLE branch below).
        formatString += "%g";
        args.push(text);
        estimatedLength += 16;
      } else {
        formatString += "%d";
        args.push(text);
        estimatedLength += 12;
      }
    } else {
      // Check for string variable reference: template_string wrapping an identifier
      const isStringVar = part.kind === "template_string"
        && part.expression.kind === "identifier"
        && (activeStringVars.has((part.expression as any).value) || getCurrentIrTypeScope()?.locals.get((part.expression as any).value) === "std::string" || getCurrentIrTypeScope()?.globals.get((part.expression as any).value) === "std::string");

      // Check for float variable reference: template_string wrapping an identifier.
      // A var initialized from a double-returning HAL op (sensor.get) records
      // as a float var; one declared `: number` from such an initializer also
      // lands in the IR scope's float types.
      const isFloatVar = part.kind === "template_string"
        && part.expression.kind === "identifier"
        && floatVariables.has((part.expression as any).value);

      // Inline double-returning HAL call (template_string wrapping a call):
      // the lowerings' deterministic shape for a double return is
      // `static_cast<double>(...)` — Time.now()/sensor.get()/millivolt reads.
      // Formatting that with the %d default is a -Wformat warning at best and
      // wrong output at worst; %g matches the float-variable branch.
      const isDoubleCall = part.kind === "template_string"
        && /^static_cast<double>\(/.test(text);

      if (isStringVar) {
        formatString += "%s";
        const varName = (part.expression as any).value;
        const varType = getCurrentIrTypeScope()?.locals.get(varName) || getCurrentIrTypeScope()?.globals.get(varName) || "";
        // Normalize through the ACTIVE strategy before the char* check — the
        // IR scope carries the pre-normalization type ("std::string") while
        // the declaration renderer emitted the strategy's mapping of it
        // (Zephyr: std::string → const char*). Without this, a string-literal
        // variable declares as const char* but its snprintf arg gains a
        // .c_str() that const char* does not have.
        const normalizedType = getContext().activeStrategy?.normalizeCppType(varType) ?? varType;
        const cleanType = normalizedType.replace(/\bconst\b\s*/g, "").trim();
        if (cleanType && cleanType !== "char*" && cleanType !== "const char*") {
          args.push(`${text}.c_str()`);
        } else {
          args.push(text);
        }
        estimatedLength += 32;
      } else if (isFloatVar) {
        // %g formats the double expression directly — portable (Zephyr's
        // cbprintf turns on FP support when it sees a float specifier);
        // dtostrf is AVR-only and fails to compile elsewhere.
        formatString += "%g";
        args.push(text);
        estimatedLength += 16;
      } else if (isDoubleCall) {
        // Inline double-returning HAL call (`${Time.now()}`) — the rendered
        // text IS the double expression; %g, never the %d default.
        formatString += "%g";
        args.push(text);
        estimatedLength += 16;
      } else if (part.kind === "template_string" && part.expression.kind === "hal-expr") {
        // HAL expression inside template literal — resolve via strategy
        const resolved = resolveHALExprToText(part.expression);
        const argText = resolved !== null ? resolved : text;
        const cppType = cppTypeForHalOp(part.expression.operation.operation);
        if (cppType === "const char*" || (cppType !== undefined && /char\s*\*$/.test(cppType))) {
          formatString += "%s";
          args.push(argText);
          estimatedLength += 32;
        } else if (cppType === "bool") {
          formatString += "%s";
          args.push(`(${argText} ? "true" : "false")`);
          estimatedLength += 5;
        } else if (cppType === "float" || cppType === "double") {
          // %g formats the double expression directly — no AVR-only dtostrf.
          formatString += "%g";
          args.push(argText);
          estimatedLength += 12;
        } else {
          formatString += "%d";
          args.push(argText);
          estimatedLength += 12;
        }
      } else {
        const numVal = Number(text);
        if (!isNaN(numVal) && !Number.isInteger(numVal)) {
          // A float literal (or float-valued expression) — %g directly; the
          // AVR dtostrf detour fails to compile on every other framework.
          formatString += "%g";
          args.push(text);
          estimatedLength += 16;
        } else if (
          part.kind === "template_string"
          && part.expression.kind === "binary"
          && binaryTouchesFloatVar(part.expression)
        ) {
          // Arithmetic on a double var (`tenths / 10`) is double-valued: %g,
          // not %d — the rendered text is already the C++ expression.
          formatString += "%g";
          args.push(text);
          estimatedLength += 12;
        } else {
          formatString += "%d";
          args.push(text);
          estimatedLength += 12;
        }
      }
    }
  }

  const bufName = `__cuttlefish_snprintf_${getContext().snprintfCounter++}`;
  const bufSize = Math.max(estimatedLength + 1, 16);

  prelude.push(`char ${bufName}[${bufSize}];`);
  prelude.push(`snprintf(${bufName}, sizeof(${bufName}), "${formatString}", ${args.join(", ")});`);

  return { lines: prelude, bufferName: bufName };
}
