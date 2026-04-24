// ---------------------------------------------------------------------------
// Snprintf helpers — delegates to the loaded framework package
//
// All snprintf functions live in the framework package (they are
// platform-specific C++ rendering helpers).  This module re-exposes them
// through the framework API registry so callers don't need a static import.
// ---------------------------------------------------------------------------

import { getFrameworkApi } from "../framework-api";

export type { EmissionScopeState, KnownVariableInfo, SnprintfArgRenderResult, SnprintfRenderResult, SnprintfExpressionRenderer } from "@typecode/core";

export function createEmissionScopeState(...args: any[]): any {
  return getFrameworkApi().createEmissionScopeState(...args);
}
export function cloneEmissionScopeState(...args: any[]): any {
  return getFrameworkApi().cloneEmissionScopeState(...args);
}
export function createChildEmissionScope(...args: any[]): any {
  return getFrameworkApi().createChildEmissionScope(...args);
}
export function recordVariableType(...args: any[]): any {
  return getFrameworkApi().recordVariableType(...args);
}
export function inferSnprintfArg(...args: any[]): any {
  return getFrameworkApi().inferSnprintfArg(...args);
}
export function buildSnprintfRenderResult(...args: any[]): any {
  return getFrameworkApi().buildSnprintfRenderResult(...args);
}
export function shouldUseSnprintfForArduinoString(...args: any[]): any {
  return getFrameworkApi().shouldUseSnprintfForArduinoString(...args);
}
export function statementNeedsSnprintf(...args: any[]): any {
  return getFrameworkApi().statementNeedsSnprintf(...args);
}
