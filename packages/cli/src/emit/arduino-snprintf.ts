import { loadFrameworkPackage } from "../framework-package";
import type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from "@typecode/framework-arduino";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function getArduinoFramework(): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, process.cwd());
}

export function createEmissionScopeState(): EmissionScopeState {
  return getArduinoFramework().createEmissionScopeState();
}

export function cloneEmissionScopeState(state: EmissionScopeState): EmissionScopeState {
  return getArduinoFramework().cloneEmissionScopeState(state);
}

export function createChildEmissionScope(
  parent: EmissionScopeState,
  parameters?: readonly { name: string; cppType: string }[],
): EmissionScopeState {
  return getArduinoFramework().createChildEmissionScope(parent, parameters);
}

export function recordVariableType(statement: unknown, scopeState: EmissionScopeState): void {
  return getArduinoFramework().recordVariableType(statement, scopeState);
}

export function inferSnprintfArg(
  expr: unknown,
  strategy: unknown,
  scopeState: EmissionScopeState,
  renderExpression: (expr: unknown) => string,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
): SnprintfArgRenderResult | undefined {
  return getArduinoFramework().inferSnprintfArg(
    expr,
    strategy,
    scopeState,
    renderExpression,
    pointerVarTypes,
    knownFunctionReturnTypes,
  );
}

export function buildSnprintfRenderResult(
  expr: unknown,
  strategy: unknown,
  scopeState: EmissionScopeState,
  renderExpression: (expr: unknown) => string,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
): SnprintfRenderResult | undefined {
  return getArduinoFramework().buildSnprintfRenderResult(
    expr,
    strategy,
    scopeState,
    renderExpression,
    pointerVarTypes,
    knownFunctionReturnTypes,
  );
}

export function shouldUseSnprintfForArduinoString(
  statement: unknown,
  strategy: unknown,
): boolean {
  return getArduinoFramework().shouldUseSnprintfForArduinoString(statement, strategy);
}

export function statementNeedsSnprintf(
  statement: unknown,
  strategy: unknown,
): boolean {
  return getArduinoFramework().statementNeedsSnprintf(statement, strategy);
}

export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
};
