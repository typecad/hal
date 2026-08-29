// ---------------------------------------------------------------------------
// Snprintf helpers for template literal / string-concat lowering
//
// Generates snprintf-based C++ code for string concatenation expressions on
// platforms whose C++ runtime lacks std::string (e.g. AVR).
//
// All logic lives in the CLI; no framework package dependency.
// Types are imported from @typecad/cuttlefish/api/shared.
// ---------------------------------------------------------------------------

import type { ExpressionIR, StatementIR, VariableDeclarationIR } from "../api/shared/index.js";
import type { PlatformStrategy } from "../api/shared/index.js";
import type { KnownVariableInfo, SnprintfArgRenderResult, SnprintfRenderResult, EmissionScopeState, SnprintfExpressionRenderer } from "../api/shared/index.js";
import { escapeCppStringLiteral } from "../utils/strings.js";
import { cppTypeForHalOp } from "./utils/hal-op-cpp-type.js";
import { formatKindOf, parseCppType, parsedElementString, parsedIsStringLike } from "../api/shared/cpp-type-ir.js";

export type { KnownVariableInfo, SnprintfArgRenderResult, SnprintfRenderResult, EmissionScopeState, SnprintfExpressionRenderer };

// ---------------------------------------------------------------------------
// Scope state management
// ---------------------------------------------------------------------------

export function createEmissionScopeState(initialTypes?: Map<string, KnownVariableInfo>): EmissionScopeState {
  return {
    knownVariableTypes: initialTypes ? new Map(initialTypes) : new Map(),
    snprintfBuffers: new Set<string>(),
    nextSnprintfTempId: 0,
  };
}

export function cloneEmissionScopeState(state: EmissionScopeState): EmissionScopeState {
  return {
    knownVariableTypes: new Map(state.knownVariableTypes),
    snprintfBuffers: new Set(state.snprintfBuffers),
    nextSnprintfTempId: state.nextSnprintfTempId,
  };
}

export function createChildEmissionScope(
  baseScope: EmissionScopeState,
  parameters?: readonly { name: string; cppType: string }[],
): EmissionScopeState {
  const childScope = cloneEmissionScopeState(baseScope);
  for (const parameter of parameters ?? []) {
    childScope.knownVariableTypes.set(parameter.name, { cppType: parameter.cppType });
  }
  return childScope;
}

// ---------------------------------------------------------------------------
// Variable tracking
// ---------------------------------------------------------------------------

function getFloatPrecisionFromNumber(value: number): number | undefined {
  if (!Number.isFinite(value) || Number.isInteger(value)) return undefined;
  const text = `${value}`;
  const decimalIndex = text.indexOf(".");
  if (decimalIndex === -1) return undefined;
  return text.length - decimalIndex - 1;
}

function expressionInvolvesFloat(expr: ExpressionIR | undefined): boolean {
  if (!expr) return false;
  switch (expr.kind) {
    case "number":
      return !Number.isInteger(expr.value);
    case "binary":
      return expressionInvolvesFloat(expr.left) || expressionInvolvesFloat(expr.right);
    case "unary":
      return expressionInvolvesFloat(expr.operand);
    case "paren":
      return expressionInvolvesFloat(expr.inner);
    case "ternary":
      return expressionInvolvesFloat(expr.condition) || expressionInvolvesFloat(expr.whenTrue) || expressionInvolvesFloat(expr.whenFalse);
    case "method-call":
      return expr.args.some(expressionInvolvesFloat);
    case "property-access":
      return expressionInvolvesFloat(expr.object);
    case "element-access":
      return expressionInvolvesFloat(expr.object) || expressionInvolvesFloat(expr.index);
    case "template_string":
      return expressionInvolvesFloat(expr.expression);
    case "string_concat":
      return expr.parts.some(expressionInvolvesFloat);
    case "raw":
      return /\b\d+\.\d+\b/.test(expr.value);
    default:
      return false;
  }
}

function findFloatPrecision(expr: ExpressionIR | undefined): number | undefined {
  if (!expr) return undefined;
  if (expr.kind === "number") return getFloatPrecisionFromNumber(expr.value);
  if (expr.kind === "binary") return findFloatPrecision(expr.left) ?? findFloatPrecision(expr.right);
  if (expr.kind === "unary") return findFloatPrecision(expr.operand);
  if (expr.kind === "paren") return findFloatPrecision(expr.inner);
  if (expr.kind === "raw") {
    const match = expr.value.match(/\b(\d+\.\d+)\b/);
    if (match) return getFloatPrecisionFromNumber(parseFloat(match[1]));
  }
  return undefined;
}

export function recordVariableType(statement: VariableDeclarationIR, scopeState: EmissionScopeState): void {
  const involvesFloat = expressionInvolvesFloat(statement.initializer);
  const effectiveCppType = statement.cppType === "auto" && involvesFloat ? "float" : statement.cppType;
  scopeState.knownVariableTypes.set(statement.name, {
    cppType: effectiveCppType,
    floatPrecision: statement.initializer?.kind === "number"
      ? getFloatPrecisionFromNumber(statement.initializer.value)
      : (effectiveCppType === "float" || effectiveCppType === "double") ? findFloatPrecision(statement.initializer) : undefined,
    // Retain the initializer for auto-deduced locals so the specifier picker
    // can resolve the real C++ type lazily (e.g. `const name = loot.name`
    // emits as `auto` but resolves to std::string).
    initializer: effectiveCppType === "auto" ? statement.initializer : undefined,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export { escapeCppStringLiteral };

// ---------------------------------------------------------------------------
// Snprintf arg inference
// ---------------------------------------------------------------------------

export function inferSnprintfArg(
  expr: ExpressionIR,
  strategy: PlatformStrategy,
  scopeState: EmissionScopeState,
  renderExpression: SnprintfExpressionRenderer,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
  stringVarNames?: Set<string>,
): SnprintfArgRenderResult | undefined {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || expr.cppType === "double" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        const rendered = str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
        const precision = getFloatPrecisionFromNumber(expr.value);
        const floatArgN = strategy.floatToSnprintfArg?.(rendered, precision, ++scopeState.nextSnprintfTempId);
        if (floatArgN !== undefined) return floatArgN;
        return {
          format: precision !== undefined ? `%.${precision}f` : "%g",
          arg: rendered,
          estimatedLength: 8,
          preludeLines: [],
        };
      }
      return { format: "%d", arg: `${expr.value}`, estimatedLength: 12, preludeLines: [] };
    }
    case "boolean":
      return {
        format: "%s",
        arg: expr.value ? '"true"' : '"false"',
        estimatedLength: 5,
        preludeLines: [],
      };
    case "string":
      return {
        format: "%s",
        arg: `"${escapeCppStringLiteral(expr.value)}"`,
        estimatedLength: Math.max(expr.value.length, 1),
        preludeLines: [],
      };
    case "identifier": {
      const knownVar = scopeState.knownVariableTypes.get(expr.value);
      const cppType = knownVar?.cppType ?? knownFunctionReturnTypes?.get(expr.value);
      if (cppType && strategy.isStringLikeType(cppType)) {
        const normalized = strategy.normalizeCppType(cppType);
        const needsCStr = parsedIsStringLike(normalized);
        const arg = needsCStr ? `${expr.value}.c_str()` : expr.value;
        return { format: "%s", arg, estimatedLength: 24, preludeLines: [] };
      }
      // Format-specifier ladder. Kept as explicit per-name branches because
      // printf specifiers distinguish widths that a coarse kind-bucket would
      // collapse (e.g. `unsigned long` → %lu vs `long long` → %lld).
      if (cppType === "bool") {
        return { format: "%s", arg: `(${expr.value} ? "true" : "false")`, estimatedLength: 5, preludeLines: [] };
      }
      if (cppType === "float" || cppType === "double") {
        const floatArgI = strategy.floatToSnprintfArg?.(expr.value, knownVar?.floatPrecision, ++scopeState.nextSnprintfTempId);
        if (floatArgI !== undefined) return floatArgI;
        return {
          format: knownVar?.floatPrecision !== undefined ? `%.${knownVar.floatPrecision}f` : "%g",
          arg: expr.value,
          estimatedLength: 8,
          preludeLines: [],
        };
      }
      if (cppType === "int" || cppType === "short" || cppType === "int16_t" || cppType === "int32_t" || cppType === "auto") {
        return { format: "%d", arg: expr.value, estimatedLength: 12, preludeLines: [] };
      }
      if (cppType === "uint16_t" || cppType === "uint32_t") {
        return { format: "%u", arg: expr.value, estimatedLength: 12, preludeLines: [] };
      }
      if (cppType === "long") {
        return { format: "%ld", arg: expr.value, estimatedLength: 12, preludeLines: [] };
      }
      if (cppType === "unsigned long") {
        return { format: "%lu", arg: expr.value, estimatedLength: 12, preludeLines: [] };
      }
      if (cppType === "long long" || cppType === "unsigned long long" || cppType === "int64_t" || cppType === "uint64_t") {
        return { format: "%lld", arg: expr.value, estimatedLength: 20, preludeLines: [] };
      }
      if (pointerVarTypes?.has(expr.value)) {
        const pointerType = pointerVarTypes.get(expr.value)!;
        if (strategy.isStringLikeType(pointerType)) {
          return { format: "%s", arg: expr.value, estimatedLength: 24, preludeLines: [] };
        }
      }
      if (stringVarNames?.has(expr.value)) {
        return { format: "%s", arg: expr.value, estimatedLength: 32, preludeLines: [] };
      }
      return { format: "%d", arg: expr.value, estimatedLength: 12, preludeLines: [] };
    }
    case "template_string":
      return inferSnprintfArg(expr.expression, strategy, scopeState, renderExpression, pointerVarTypes, knownFunctionReturnTypes, stringVarNames);
    case "paren":
      return inferSnprintfArg(expr.inner, strategy, scopeState, renderExpression, pointerVarTypes, knownFunctionReturnTypes, stringVarNames);
    case "raw": {
      if (/^__tc_/.test(expr.value)) {
        return { format: "%s", arg: renderExpression(expr), estimatedLength: 32, preludeLines: [] };
      }
      if (/^std::string\(/.test(expr.value)) {
        return { format: "%s", arg: renderExpression(expr), estimatedLength: 32, preludeLines: [] };
      }
      const callMatch = expr.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (callMatch) {
        const funcName = callMatch[1];
        if (knownFunctionReturnTypes) {
          const returnType = knownFunctionReturnTypes.get(funcName);
          if (returnType && strategy.isStringLikeType(returnType)) {
            return { format: "%s", arg: renderExpression(expr), estimatedLength: 24, preludeLines: [] };
          }
          if (returnType === "bool") {
            const rendered = renderExpression(expr);
            return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5, preludeLines: [] };
          }
          if (returnType === "float" || returnType === "double") {
            const rendered = renderExpression(expr);
            const floatArgR = strategy.floatToSnprintfArg?.(rendered, undefined, ++scopeState.nextSnprintfTempId);
            if (floatArgR !== undefined) return floatArgR;
            return { format: "%g", arg: rendered, estimatedLength: 8, preludeLines: [] };
          }
          if (returnType === "int" || returnType === "long" || returnType === "short") {
            return { format: "%d", arg: renderExpression(expr), estimatedLength: 12, preludeLines: [] };
          }
        }
        const halIntFunctions = new Set([
          ...(strategy?.halCallNames?.() ?? new Set<string>()),
          // pulseIn/pulseInLong and the Wire_available/Serial_available forms
          // are framework-specific suffix conventions; frameworks may add them
          // to halCallNames. Kept as a fallback here until all frameworks do.
          "pulseIn", "pulseInLong", "Wire_available", "Serial_available",
        ]);
        if (halIntFunctions.has(funcName)) {
          return { format: "%d", arg: renderExpression(expr), estimatedLength: 12, preludeLines: [] };
        }
      }
      // Namespace-const access lowers to a raw `Ns::member` string (see
      // expression-to-ir.ts ~line 398). Resolve the member's type from
      // knownVariableTypes (namespace consts are registered there by bare
      // name in setup.ts) so a namespace `const string` formats as %s with
      // .c_str(), not the %d default (namespace stress test Finding 3b).
      const nsConstMatch = expr.value.match(/^[A-Za-z_$][\w$]*::([A-Za-z_$][\w$]*)$/);
      if (nsConstMatch) {
        const memberType = scopeState.knownVariableTypes.get(nsConstMatch[1]);
        if (memberType) {
          const rendered = renderExpression(expr);
          if (strategy.isStringLikeType(memberType.cppType)) {
            const normalized = strategy.normalizeCppType(memberType.cppType);
            const needsCStr = parsedIsStringLike(normalized);
            return { format: "%s", arg: needsCStr ? `${rendered}.c_str()` : rendered, estimatedLength: 32, preludeLines: [] };
          }
          if (memberType.cppType === "bool") {
            return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5, preludeLines: [] };
          }
        }
      }
      return undefined;
    }
    case "property-access": {
      const rendered = renderExpression(expr);
      if (rendered.startsWith('"')) {
        return { format: "%s", arg: rendered, estimatedLength: Math.max(rendered.length - 2, 1), preludeLines: [] };
      }
      if (expr.property === "length" || expr.property === "size") {
        return { format: "%d", arg: rendered, estimatedLength: 10, preludeLines: [] };
      }
      const numVal = Number(rendered);
      if (!isNaN(numVal)) {
        if (Number.isInteger(numVal) && (numVal > 32767 || numVal < -32768)) {
          return { format: "%ld", arg: `${rendered}L`, estimatedLength: 12, preludeLines: [] };
        }
        if (!Number.isInteger(numVal)) {
          const precision = getFloatPrecisionFromNumber(numVal);
          const floatArg = strategy.floatToSnprintfArg?.(rendered, precision, ++scopeState.nextSnprintfTempId);
          if (floatArg !== undefined) return floatArg;
          return {
            format: precision !== undefined ? `%.${precision}f` : "%g",
            arg: rendered,
            estimatedLength: 8,
            preludeLines: [],
          };
        }
      }
      // Namespace-const (or other registered) member access: resolve the
      // member's type from knownVariableTypes (namespace consts are
      // registered there by their bare name in setup.ts). Without this, a
      // namespace `const string` used in a concat fell through to the %d
      // default below (namespace stress test Finding 3b).
      const nsMemberType = scopeState.knownVariableTypes.get(expr.property);
      if (nsMemberType) {
        const normalized = strategy.normalizeCppType(nsMemberType.cppType);
        if (strategy.isStringLikeType(nsMemberType.cppType)) {
          const needsCStr = parsedIsStringLike(normalized);
          return { format: "%s", arg: needsCStr ? `${rendered}.c_str()` : rendered, estimatedLength: 32, preludeLines: [] };
        }
        if (nsMemberType.cppType === "bool") {
          return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5, preludeLines: [] };
        }
      }
      return { format: "%d", arg: rendered, estimatedLength: 12, preludeLines: [] };
    }
    case "binary":
    case "unary":
    case "ternary":
      if (expressionInvolvesFloat(expr as ExpressionIR)) {
        const rendered = renderExpression(expr);
        return { format: "%g", arg: rendered, estimatedLength: 16, preludeLines: [] };
      }
      return { format: "%d", arg: renderExpression(expr), estimatedLength: 12, preludeLines: [] };
    case "method-call": {
      const rendered = renderExpression(expr);
      if (/^__tc_(toUpperCase|toLowerCase|trim|replace|charAt|substring|slice|endsWith|toUpperCaseChar)\b/.test(rendered)) {
        return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
      }
      const numVal = Number(rendered);
      if (!isNaN(numVal) && rendered.trim() !== "") {
        if (!Number.isInteger(numVal)) {
          const precision = getFloatPrecisionFromNumber(numVal);
          const floatArg = strategy.floatToSnprintfArg?.(rendered, precision, ++scopeState.nextSnprintfTempId);
          if (floatArg !== undefined) return floatArg;
          return {
            format: precision !== undefined ? `%.${precision}f` : "%g",
            arg: rendered,
            estimatedLength: 8,
            preludeLines: [],
          };
        }
      }
      if (typeof expr.callee === "string") {
        const methodNameMatch = expr.callee.match(/->(\w+)\(\)$/);
        if (methodNameMatch && knownFunctionReturnTypes) {
          const methodReturn = knownFunctionReturnTypes.get(methodNameMatch[1]);
          if (methodReturn && strategy.isStringLikeType(methodReturn)) {
            return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
          }
        }
      }
      return { format: "%d", arg: rendered, estimatedLength: 12, preludeLines: [] };
    }
    case "element-access": {
      const rendered = renderExpression(expr);
      if (expr.elementType && strategy.isStringLikeType(expr.elementType)) {
        return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
      }
      if (expr.object.kind === "identifier") {
        const objInfo = scopeState.knownVariableTypes.get(expr.object.value);
        if (objInfo) {
          const elemStr = parsedElementString(objInfo.cppType);
          if (elemStr && strategy.isStringLikeType(elemStr)) {
            return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
          }
        }
      }
      return { format: "%d", arg: rendered, estimatedLength: 12, preludeLines: [] };
    }
    case "hal-expr": {
      const rendered = renderExpression(expr);
      if (rendered.startsWith('"') || stringVarNames?.has(rendered)) {
        return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
      }
      const cppType = cppTypeForHalOp(expr.operation.operation);
      if (cppType && strategy.isStringLikeType(cppType)) {
        return { format: "%s", arg: rendered, estimatedLength: 32, preludeLines: [] };
      }
      if (cppType === "bool") {
        return { format: "%s", arg: `(${rendered} ? "true" : "false")`, estimatedLength: 5, preludeLines: [] };
      }
      return { format: "%d", arg: rendered, estimatedLength: 12, preludeLines: [] };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Snprintf usage detection
// ---------------------------------------------------------------------------

export function statementNeedsSnprintf(statement: StatementIR, strategy: PlatformStrategy): boolean {
  if (!strategy.useSnprintfForStrings()) {
    return false;
  }

  if (statement.kind === "var_decl" && statement.initializer?.kind === "string_concat") {
    return true;
  }

  if (statement.kind === "assign" && statement.value?.kind === "string_concat") {
    return true;
  }

  if (statement.kind === "call" && statement.args.length > 0) {
    // __EMIT__ calls resolve their args inline as raw C++ text — they never
    // use snprintf, even when the arg is a string_concat from a template literal.
    if (statement.callee === "__EMIT__") return false;
    if (statement.args.some((arg) => arg.kind === "string_concat" || arg.kind === "template_string")) {
      return true;
    }
  }

  if (statement.kind === "return" && statement.value?.kind === "string_concat") {
    return true;
  }

  switch (statement.kind) {
    case "while":
    case "for":
    case "for_of":
    case "for_in":
    case "do_while":
    case "block":
    case "labeled":
      return statement.body.some((nested) => statementNeedsSnprintf(nested, strategy));
    case "if":
      return statement.thenBranch.some((nested) => statementNeedsSnprintf(nested, strategy)) ||
        (statement.elseBranch?.some((nested) => statementNeedsSnprintf(nested, strategy)) ?? false);
    case "switch":
      return statement.cases.some((caseClause) => caseClause.body.some((nested) => statementNeedsSnprintf(nested, strategy)));
    case "try":
      return statement.tryBlock.some((nested) => statementNeedsSnprintf(nested, strategy)) ||
        (statement.catchBlock?.some((nested) => statementNeedsSnprintf(nested, strategy)) ?? false) ||
        (statement.finallyBlock?.some((nested) => statementNeedsSnprintf(nested, strategy)) ?? false);
    default:
      return false;
  }
}
