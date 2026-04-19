/**
 * Arduino snprintf rendering — thin re-export from @typecode/framework-arduino
 */
export {
  createEmissionScopeState,
  cloneEmissionScopeState,
  createChildEmissionScope,
  recordVariableType,
  inferSnprintfArg,
  buildSnprintfRenderResult,
  shouldUseSnprintfForArduinoString,
  statementNeedsSnprintf,
} from "@typecode/framework-arduino";
export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from "@typecode/framework-arduino";
