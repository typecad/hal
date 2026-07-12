// ---------------------------------------------------------------------------
// TranspilerUIHook — the contract between cuttlefish core and the (optional)
// @typecad/ui package's transpiler engine.
//
// Cuttlefish core never statically imports from @typecad/ui. Instead, when UI
// usage is detected in user code, transpile.ts dynamically imports
// @typecad/ui/engine and calls its registerTranspilerUI() function, which
// returns an object implementing this interface. Core code then calls through
// getUIHook() instead of importing ui/ modules directly.
//
// When @typecad/ui is not installed, the hook stays null and UI processing is
// skipped — cuttlefish works as a pure TypeScript→C++ transpiler.
// ---------------------------------------------------------------------------

import type { LoweredUI } from "./ir/transformers/ui-lowering.js";
import type { Diagnostic } from "./api/shared/index.js";

// Re-export types that appear in hook signatures so consumers can reference
// them without importing from ui/ directly.
export type { LoweredUI } from "./ir/transformers/ui-lowering.js";

// The real UIModule and LowerOptions types live in ui/ui-registry.ts. During
// Phase 3 (all files in-package) we import them directly. After the Phase 5
// move, these will be re-exported from @typecad/ui's public types.
export type { UIModule, LowerOptions } from "./ui/ui-registry.js";

// Re-export the UiFileParts type from ui-file-splitter.
export type { UiFileParts } from "./ui/ui-file-splitter.js";

/** The capabilities cuttlefish core needs from the UI engine. */
export interface TranspilerUIHook {
  // ── Registry: loading and querying UI modules ───────────────────────────
  resetUIRegistry(): void;
  loadUIModule(htmlPath: string): import("./ui/ui-registry.js").UIModule | undefined;
  loadUIModuleFromText(htmlPath: string, htmlText: string, cssText: string, cssPathForFonts?: string): import("./ui/ui-registry.js").UIModule;
  getUIModule(htmlPath: string): import("./ui/ui-registry.js").UIModule | undefined;
  hasUIModule(htmlPath: string): boolean;
  allUIModules(): import("./ui/ui-registry.js").UIModule[];
  allLoweredUIModules(): Array<{ htmlPath: string; lowered: LoweredUI }>;

  // ── Entry-point UI detection ────────────────────────────────────────────
  markEntryHasUI(): void;
  entryHasUI(): boolean;
  clearEntryHasUI(): void;

  // ── Lowering ────────────────────────────────────────────────────────────
  lowerOnMount(htmlPath: string, opts: import("./ui/ui-registry.js").LowerOptions): LoweredUI;

  // ── Color resolution (used by IR transformers) ──────────────────────────
  resolveColor(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number;
  resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number;

  // ── Runtime header emission ─────────────────────────────────────────────
  emitRuntimeHeader(): string;

  // ── File splitting ──────────────────────────────────────────────────────
  splitUiFile(src: string): import("./ui/ui-file-splitter.js").UiFileParts;

  // ── Type declaration generation ─────────────────────────────────────────
  generateProjectUITypeDeclarations(projectRoot: string): import("./ui/ui-registry.js").UITypeDeclarationResult;

  // ── Scroll memory diagnostics ───────────────────────────────────────────
  analyzeScrollMemory(styled: unknown, budget: number): Diagnostic[];
}

// ── Module-level hook state ────────────────────────────────────────────────

let uiHook: TranspilerUIHook | null = null;

/** Set the UI hook. Called by transpile.ts after dynamically loading
 *  @typecad/ui/engine. Passing null clears it (end of transpile run). */
export function setUIHook(hook: TranspilerUIHook | null): void {
  uiHook = hook;
}

/** Get the current UI hook, or null if @typecad/ui is not loaded. */
export function getUIHook(): TranspilerUIHook | null {
  return uiHook;
}

/** Returns true if the UI hook is registered (i.e. @typecad/ui is loaded). */
export function hasUIHook(): boolean {
  return uiHook !== null;
}

/** Get the UI hook, throwing if it's not set. Use in code paths that are
 *  only reached when UI is active (e.g. inside `if (entryHasUI())` blocks). */
export function requireUIHook(): TranspilerUIHook {
  if (!uiHook) {
    throw new Error(
      "UI hook is not registered. This code path requires @typecad/ui to be " +
      "installed and loaded. This should not happen — the hook is set at the " +
      "start of transpileFile() when UI is detected."
    );
  }
  return uiHook;
}

// ── Convenience accessors for the most common queries ──────────────────────
// These wrap the null-check so call sites stay clean.

/** Returns true if the entry point has UI mounted. Safe to call when the
 *  hook is not set (returns false — no UI without the engine). */
export function entryHasUI(): boolean {
  return uiHook !== null && uiHook.entryHasUI();
}
