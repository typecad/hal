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
  /**
   * The initializer expression for `auto`-deduced locals, retained so the
   * snprintf specifier picker can infer the real C++ type (e.g. resolve
   * `const name = loot.name` to `std::string` even though the decl emits as
   * `auto`). Undefined for explicitly-typed decls and parameters.
   */
  initializer?: import('./ir-core.js').ExpressionIR;
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

export type SnprintfExpressionRenderer = (expr: import('./ir-core.js').ExpressionIR) => string;
