// ---------------------------------------------------------------------------
// UI bridge — loads the UI engine from @typecad/ui and registers it.
//
// transpile.ts calls loadUIEngine() at the start of transpileFile(). If
// @typecad/ui is not installed, the import fails gracefully and the hook
// stays null — cuttlefish works as a pure TypeScript→C++ transpiler.
// ---------------------------------------------------------------------------

import { setUIHook, type TranspilerUIHook } from "../ui-hook.js";

let loaded = false;

/** Dynamically load @typecad/ui/engine and register the hook.
 *  Called by transpile.ts at the start of each transpile run.
 *  Safe to call when @typecad/ui is absent (hook stays null). */
export async function loadUIEngine(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // Dynamic import — @typecad/ui is optional. The module specifier is
    // routed through a variable (rather than a string literal) so tsc types
    // the result as `any` and never resolves @typecad/ui's declaration
    // files while type-checking this file. A literal specifier here would
    // make tsc load ui's dist/engine-index.d.ts, which imports back
    // `@typecad/cuttlefish/ui-hook` — a self-referencing package path that
    // resolves into this package's own dist/ output and causes TS5055
    // ("would overwrite input file") on every rebuild where dist/ exists.
    const uiEnginePath = "@typecad/ui/engine";
    const engine = await import(uiEnginePath);
    const hook = engine.registerTranspilerUI() as TranspilerUIHook;
    setUIHook(hook);
  } catch {
    // @typecad/ui is not installed — cuttlefish works without UI support.
  }
}
