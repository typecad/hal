// ---------------------------------------------------------------------------
// Safety bridge — registers the built-in safety engine.
//
// The engine used to ship as the optional @typecad/safety package and was
// loaded via a dynamic package import; it now lives in this package under
// src/safety/. transpile.ts still calls loadSafetyEngine() at the start of
// transpileFile(), and the hook seam (safety-hook.ts) is unchanged so the
// degradation paths (resetSafetyEngine / __simulateSafetyAbsentForTest) keep
// working for tests.
// ---------------------------------------------------------------------------

import { setSafetyHook, type TranspilerSafetyHook } from "../safety-hook.js";

let loaded = false;

/** Load the safety engine and register the hook. Called by transpile.ts at
 *  the start of each transpile run. */
export async function loadSafetyEngine(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const engine = await import("./engine.js");
  const hook = engine.registerSafetyEngine() as TranspilerSafetyHook;
  setSafetyHook(hook);
}

/** Reset the safety bridge: forget a load was attempted and clear the hook.
 *  Mirrors resetUIEngine() so each transpile run / test starts clean. */
export function resetSafetyEngine(): void {
  loaded = false;
  setSafetyHook(null);
}

/** Test-only: force the bridge into the "safety not loaded" state — mark the
 *  load as already attempted and leave the hook null, exactly as the old
 *  dynamic import behaved when @typecad/safety was not installed. */
export function __simulateSafetyAbsentForTest(): void {
  loaded = true;
  setSafetyHook(null);
}
