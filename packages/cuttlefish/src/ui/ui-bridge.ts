// ---------------------------------------------------------------------------
// UI bridge — wires the real UI engine implementations into the TranspilerUIHook.
//
// This module lives in cuttlefish/src/ui/ for now (Phase 3 of the split). In
// Phase 5 it moves to @typecad/ui/src/ui-engine/ and becomes the
// registerTranspilerUI() entry point that cuttlefish loads dynamically.
//
// For now, transpile.ts calls registerTranspilerUI() directly (static import)
// to populate the hook. Once the files move to the separate package, the call
// becomes: const { registerTranspilerUI } = await import("@typecad/ui/engine");
// ---------------------------------------------------------------------------

import type { TranspilerUIHook } from "../ui-hook.js";
import { setUIHook } from "../ui-hook.js";
import { resetUIRegistry, loadUIModule, loadUIModuleFromText, getUIModule, hasUIModule, allUIModules, allLoweredUIModules, markEntryHasUI, entryHasUI, clearEntryHasUI, lowerOnMount, generateProjectUITypeDeclarations } from "./ui-registry.js";
import { resolveColor, resolveColorInternal } from "./color.js";
import { emitRuntimeHeader } from "./runtime-header.js";
import { splitUiFile } from "./ui-file-splitter.js";
import { analyzeScrollMemory } from "./scroll-memory-diagnostics.js";

/**
 * Build the TranspilerUIHook with the real UI engine implementations.
 * Exported for Phase 5 when this moves to @typecad/ui and cuttlefish calls
 * it via dynamic import. For now (Phase 3), it's also called eagerly below.
 */
export function registerTranspilerUI(): TranspilerUIHook {
  return {
    resetUIRegistry,
    loadUIModule,
    loadUIModuleFromText,
    getUIModule,
    hasUIModule,
    allUIModules,
    allLoweredUIModules,
    markEntryHasUI,
    entryHasUI,
    clearEntryHasUI,
    lowerOnMount,
    resolveColor,
    resolveColorInternal,
    emitRuntimeHeader,
    splitUiFile,
    generateProjectUITypeDeclarations,
    analyzeScrollMemory,
  };
}

// Eager self-registration: populate the hook on module load so any code that
// imports transpile.ts (directly or transitively) has the hook available.
// This is temporary for Phase 3 — in Phase 5 this file moves to @typecad/ui
// and registration becomes an explicit dynamic-import call in transpile.ts.
setUIHook(registerTranspilerUI());
