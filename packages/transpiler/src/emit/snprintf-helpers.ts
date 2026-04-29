// ---------------------------------------------------------------------------
// Snprintf helpers for template literal / string-concat lowering
//
// Generates snprintf-based C++ code for string concatenation expressions on
// platforms whose C++ runtime lacks std::string (e.g. AVR).
//
// All logic lives in the CLI; no framework package dependency.
// Types are imported from @typehal/core/shared.
// ---------------------------------------------------------------------------

import type { AssignmentIR, ExpressionIR, StatementIR, VariableDeclarationIR } from "@typehal/core/shared";
import type { PlatformStrategy } from "@typehal/core/shared";
import type { KnownVariableInfo, SnprintfArgRenderResult, SnprintfRenderResult, EmissionScopeState, SnprintfExpressionRenderer } from "@typehal/core/shared";

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

export function recordVariableType(statement: VariableDeclarationIR, scopeState: EmissionScopeState): void {
  scopeState.knownVariableTypes.set(statement.name, {
    cppType: statement.cppType,
    floatPrecision: statement.initializer?.kind === "number"
      ? getFloatPrecisionFromNumber(statement.initializer.value)
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeCppStringLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function isStringLikeCppType(typeName: string): boolean {
  return typeName === "std::string" || typeName === "const char*" || typeName === "char*";
}

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
): SnprintfArgRenderResult | undefined {
  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
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
      const cppType = knownVar?.cppType;
      if (cppType && isStringLikeCppType(cppType)) {
        return { format: "%s", arg: expr.value, estimatedLength: 24, preludeLines: [] };
      }
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
      if (cppType === "int" || cppType === "long" || cppType === "short" || cppType === "auto") {
        return { format: "%d", arg: expr.value, estimatedLength: 12, preludeLines: [] };
      }
      if (pointerVarTypes?.has(expr.value)) {
        const pointerType = pointerVarTypes.get(expr.value)!;
        if (isStringLikeCppType(pointerType)) {
          return { format: "%s", arg: expr.value, estimatedLength: 24, preludeLines: [] };
        }
      }
      return undefined;
    }
    case "raw": {
      const callMatch = expr.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (callMatch && knownFunctionReturnTypes) {
        const returnType = knownFunctionReturnTypes.get(callMatch[1]);
        if (returnType && isStringLikeCppType(returnType)) {
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
      return undefined;
    }
    case "property-access": {
      // Render first so board constants are folded to their C++ literal values.
      const rendered = renderExpression(expr);
      // String constant (e.g. Board.definition.mcu → "ATmega328P")
      if (rendered.startsWith('"')) {
        return { format: "%s", arg: rendered, estimatedLength: Math.max(rendered.length - 2, 1), preludeLines: [] };
      }
      // Numeric constant that overflows AVR 16-bit signed int — emit as long.
      const numVal = Number(rendered);
      if (Number.isInteger(numVal) && !isNaN(numVal) && (numVal > 32767 || numVal < -32768)) {
        return { format: "%ld", arg: `${rendered}L`, estimatedLength: 12, preludeLines: [] };
      }
      return { format: "%d", arg: rendered, estimatedLength: 12, preludeLines: [] };
    }
    case "binary":
    case "unary":
    case "ternary":
    case "typehal-call":
      return { format: "%d", arg: renderExpression(expr), estimatedLength: 12, preludeLines: [] };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Snprintf render result builder
// ---------------------------------------------------------------------------

export function buildSnprintfRenderResult(
  expr: ExpressionIR,
  strategy: PlatformStrategy,
  scopeState: EmissionScopeState,
  renderExpression: SnprintfExpressionRenderer,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
): SnprintfRenderResult | undefined {
  if (expr.kind !== "string_concat") {
    return undefined;
  }

  let formatString = "";
  const args: string[] = [];
  let estimatedLength = 1;
  const preludeLines: string[] = [];

  for (const part of expr.parts) {
    if (part.kind === "string") {
      formatString += escapeCppStringLiteral(part.value);
      estimatedLength += part.value.length;
      continue;
    }

    if (part.kind !== "template_string") {
      return undefined;
    }

    const arg = inferSnprintfArg(
      part.expression,
      strategy,
      scopeState,
      renderExpression,
      pointerVarTypes,
      knownFunctionReturnTypes,
    );
    if (!arg) {
      return undefined;
    }

    formatString += arg.format;
    args.push(arg.arg);
    estimatedLength += arg.estimatedLength;
    preludeLines.push(...arg.preludeLines);
  }

  return { formatString, args, estimatedLength: Math.max(estimatedLength, 16), preludeLines };
}

// ---------------------------------------------------------------------------
// Snprintf usage detection
// ---------------------------------------------------------------------------

export function shouldUseSnprintfForString(
  statement: VariableDeclarationIR | AssignmentIR,
  strategy: PlatformStrategy,
): boolean {
  if (!strategy.useSnprintfForStrings()) {
    return false;
  }

  const value = statement.kind === "var_decl" ? statement.initializer : statement.value;
  return value?.kind === "string_concat";
}

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

  if ((statement.kind === "call" || statement.kind === "typehal-call") && statement.args.length > 0) {
    if (statement.args.some((arg) => arg.kind === "string_concat")) {
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
