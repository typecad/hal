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
import { parseCppType, parsedElementString, parsedIsStringLike } from "../api/shared/cpp-type-ir.js";

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
