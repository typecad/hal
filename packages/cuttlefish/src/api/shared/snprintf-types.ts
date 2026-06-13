// ---------------------------------------------------------------------------
// Snprintf types for emission scope state and render results
//
// These types describe the data structures used by the snprintf-based
// template literal lowering system. Defined here so both CLI and framework
// packages can reference them without a circular dependency.
// ---------------------------------------------------------------------------

export interface KnownVariableInfo {
  cppType: string;
  floatPrecision?: number;
}

export interface SnprintfArgRenderResult {
  format: string;
  arg: string;
  estimatedLength: number;
  preludeLines: string[];
}

export interface SnprintfRenderResult {
  formatString: string;
  args: string[];
  estimatedLength: number;
  preludeLines: string[];
}

export interface EmissionScopeState {
  readonly knownVariableTypes: Map<string, KnownVariableInfo>;
  readonly snprintfBuffers: Set<string>;
  nextSnprintfTempId: number;
}

export type SnprintfExpressionRenderer = (expr: import('./ir-core').ExpressionIR) => string;
