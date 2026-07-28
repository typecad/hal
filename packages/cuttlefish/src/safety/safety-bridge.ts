// ---------------------------------------------------------------------------
// Safety bridge — loads the safety engine from @typecad/safety and registers it.
//
// transpile.ts calls loadSafetyEngine() at the start of transpileFile(). If
// @typecad/safety is not installed, the import fails gracefully and the hook
// stays null — cuttlefish works as a pure TS→C++ transpiler with no safety
// support.
// ---------------------------------------------------------------------------

import { setSafetyHook, type TranspilerSafetyHook } from "../safety-hook.js";

let loaded = false;

/** Dynamically load @typecad/safety/engine and register the hook.
 *  Called by transpile.ts at the start of each transpile run.
 *  Safe to call when @typecad/safety is absent (hook stays null). */
export async function loadSafetyEngine(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // Dynamic import — @typecad/safety is optional. The module specifier is
    // routed through a variable (rather than a string literal) so tsc types
    // the result as `any` and never resolves @typecad/safety's declaration
    // files while type-checking this file. A literal specifier would make tsc
    // load safety's dist/engine-index.d.ts, which imports back
    // @typecad/cuttlefish/safety-hook-types — a self-referencing package path
    // that resolves into this package's own dist/ output and causes TS5055
    // ("would overwrite input file") on every rebuild where dist/ exists.
    const safetyEnginePath = "@typecad/safety/engine";
    const engine = await import(safetyEnginePath);
    const hook = engine.registerSafetyEngine() as TranspilerSafetyHook;
    setSafetyHook(hook);
  } catch {
    // @typecad/safety is not installed — cuttlefish works without safety.
  }
}

/** Reset the safety bridge: forget a load was attempted and clear the hook.
 *  Mirrors resetUIEngine() so each transpile run / test starts clean. */
export function resetSafetyEngine(): void {
  loaded = false;
  setSafetyHook(null);
}

/** Test-only: force the bridge into the "no @typecad/safety" state — mark the
 *  load as already attempted and leave the hook null, exactly as if the
 *  dynamic import had failed because the package is not installed. */
export function __simulateSafetyAbsentForTest(): void {
  loaded = true;
  setSafetyHook(null);
}
