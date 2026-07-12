// ---------------------------------------------------------------------------
// UI bridge — loads the UI engine from @typecad/ui and registers it.
//
// transpile.ts calls loadUIEngine() at the start of transpileFile(). If
// @typecad/ui is not installed, the import fails gracefully and the hook
// stays null — cuttlefish works as a pure TypeScript→C++ transpiler.
// ---------------------------------------------------------------------------

import { setUIHook } from "../ui-hook.js";

let loaded = false;

/** Dynamically load @typecad/ui/engine and register the hook.
 *  Called by transpile.ts at the start of each transpile run.
 *  Safe to call when @typecad/ui is absent (hook stays null). */
export async function loadUIEngine(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // Dynamic import — @typecad/ui is optional. The @ts-ignore suppresses
    // the "cannot find module" error during clean builds when ui's dist
    // doesn't exist yet (cuttlefish builds before ui).
    // @ts-ignore — optional dependency, resolved at runtime
    const engine = await import("@typecad/ui/engine");
    const hook = engine.registerTranspilerUI();
    setUIHook(hook);
  } catch {
    // @typecad/ui is not installed — cuttlefish works without UI support.
  }
}
