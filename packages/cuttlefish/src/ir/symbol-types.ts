// ---------------------------------------------------------------------------
// IrTypeScope — the per-file, per-function type/symbol scratch space.
//
// Phase 1 of the type-resolution consolidation. Previously the IR build mutated
// three `AsyncLocalStorage`-proxied globals (activeLocalTypes,
// activeGlobalTypes, activeClassFieldTypes) exported from build-ir-state.ts.
// Those globals were a redundant shadow of the `localVariableTypes` parameter
// already threaded through control-flow.ts / expressions.ts / variables.ts /
// type-resolution.ts (see statement-to-ir.ts:397, which synced the threaded
// map back INTO the global on every function boundary).
//
// IrTypeScope replaces all three globals with an explicit object:
//   - `locals`     (was activeLocalTypes): function-scoped, reset between
//                  functions, re-seeded from `classFields` on reset (mirroring
//                  the old resetFunctionScopeState behavior at build-ir-state).
//   - `globals`    (was activeGlobalTypes): file-scoped, accumulates across
//                  functions; cleared once per file in resetBuildState.
//   - `classFields` (was activeClassFieldTypes): keyed `this->fieldName`;
//                  populated by declaration-builders / function-builder and
//                  survives function resets so `this->x` resolves in every
//                  method of the class.
//
// Module-private readers in expression-to-ir.ts consult whichever IrTypeScope
// is "current" via getCurrentIrTypeScope(); the IR-build entry points push a
// scope as current before lowering and clear it on reset. This preserves the
// old global behavior exactly while making the data flow explicit.
// ---------------------------------------------------------------------------

export type CppTypeHint = string;

/**
 * The bundle of type maps one IR-build scope consults. `locals` and
 * `classFields` are deliberately separate Maps even though both were folded
 * into the old activeLocalTypes at reset time — keeping them distinct makes
 * the re-seed-on-reset step visible instead of implicit.
 */
export interface IrTypeScope {
  /** Function-scoped variable types. Reset between functions, re-seeded from
   *  classFields (mirrors resetFunctionScopeState). */
  locals: Map<string, CppTypeHint>;
  /** File-scoped module-level variable types. Accumulates across functions. */
  globals: Map<string, CppTypeHint>;
  /** Class field types keyed `this->fieldName`. Populated once per class,
   *  survives function resets. */
  classFields: Map<string, CppTypeHint>;
}

export function createIrTypeScope(): IrTypeScope {
  return {
    locals: new Map(),
    globals: new Map(),
    classFields: new Map(),
  };
}

/**
 * Reset the function-scoped portion of a scope (locals only), then re-seed
 * locals from classFields so `this->field` lookups keep resolving in the next
 * method. Mirrors the old resetFunctionScopeState behavior exactly.
 */
export function resetIrTypeScopeFunctionState(scope: IrTypeScope): void {
  scope.locals.clear();
  for (const [key, value] of scope.classFields) {
    scope.locals.set(key, value);
  }
}

/**
 * Re-populate the scope's `locals` view from a caller-supplied Map, after
 * resetFunctionScopeState has already cleared locals and re-seeded from
 * classFields. Used by lowerStatementList at each entry to mirror the old
 * behavior where activeLocalTypes was cleared, re-seeded from classFields,
 * and then synced from the threaded localVariableTypes.
 *
 * IMPORTANT: this COPIES entries (it does not alias the maps). The threaded
 * `localVariableTypes` map accumulates across nested lowerStatementList calls
 * (if/for/while bodies pass it down by reference and must NOT be cleared by a
 * nested reset); `scope.locals` is the function-resettable view that readers
 * in expression-to-ir consult. Keeping them as distinct maps with a sync copy
 * here, plus mirrored writes at every localVariableTypes.set site, preserves
 * the original semantics exactly. Aliasing them would let a nested reset wipe
 * the parent's accumulated locals.
 */
export function bindIrTypeScopeLocals(
  scope: IrTypeScope,
  locals: Map<string, CppTypeHint>,
): void {
  // Fold the threaded map's current entries into the already-re-seeded locals.
  for (const [key, value] of locals) {
    scope.locals.set(key, value);
  }
}

/**
 * Mirror a single write into the scope's locals view. Callers that write to
 * the threaded localVariableTypes map must also call this so the
 * getCurrentIrTypeScope().locals readers see the new entry. This replaces the
 * old activeLocalTypes.set(...) calls that ran alongside localVariableTypes.set.
 */
export function setScopeLocalType(
  name: string,
  type: CppTypeHint,
): void {
  getCurrentIrTypeScope()?.locals.set(name, type);
}

// ---------------------------------------------------------------------------
// "Current" scope — the module-private readers in expression-to-ir.ts consult
// this when their caller did not pass an explicit scope. This keeps the ~25
// transformer call sites of expressionToIR(...) that don't carry a scope
// working unchanged, while still removing the AsyncLocalStorage global.
//
// The current-scope pointer is intentionally module-local (not async-local):
// the IR build is single-threaded and synchronous per file, and the entry
// points (build-ir.ts → lowerStatementList) always set the scope before any
// expression lowering happens within that file.
// ---------------------------------------------------------------------------

let currentIrTypeScope: IrTypeScope | undefined;

export function setCurrentIrTypeScope(scope: IrTypeScope | undefined): void {
  currentIrTypeScope = scope;
}

export function getCurrentIrTypeScope(): IrTypeScope | undefined {
  return currentIrTypeScope;
}

/**
 * Returns the current scope, throwing if none is set. For call sites that are
 * only reachable mid-lowering (the module-private readers in
 * expression-to-ir.ts), where an unset scope would be a programming error.
 */
export function requireCurrentIrTypeScope(): IrTypeScope {
  const scope = currentIrTypeScope;
  if (!scope) {
    throw new Error(
      "requireCurrentIrTypeScope: no IrTypeScope is active. An IR-build entry " +
      "point must call setCurrentIrTypeScope() before lowering expressions.",
    );
  }
  return scope;
}
