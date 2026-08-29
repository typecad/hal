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

import type { Diagnostic } from "./api/shared/index.js";

// LoweredUI — the output of UI lowering. Defined here (not imported from
// @typecad/ui) to avoid a circular type dependency. The real type in
// @typecad/ui is structurally identical.
export interface LoweredUI {
  fontTables: string;
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
  keyboardLoaders: string;
  keyboardDispatch: string;
  screenCount: number;
  imageTables: string;
  keyframeTables: string;
  diagnostics: Diagnostic[];
}

// UIModule and LowerOptions — structural aliases matching the real types in
// @typecad/ui/ui-engine/ui-registry.ts. Defined locally to avoid importing
// from @typecad/ui (which would create a circular build dependency).
export interface UIModule {
  htmlPath: string;
  typeDeclPath: string;
  typeDeclSourceRoot: string;
  typeDeclRoot: string;
  styled: unknown;
  allStyledScreens: unknown[];
  keyboards: unknown[];
  rules: unknown[];
  fontFaces: unknown[];
  fontAssets: unknown[];
  rawKeyframes: unknown[];
  diagnostics: Diagnostic[];
  mountDiagnostics: Diagnostic[];
}

export interface LowerOptions {
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
}

// Re-export the UiFileParts type.
export interface UiFileParts {
  script: string;
  style: string;
  html: string;
}

/** The capabilities cuttlefish core needs from the UI engine. */
export interface TranspilerUIHook {
  // ── Registry: loading and querying UI modules ───────────────────────────
  resetUIRegistry(): void;
  loadUIModule(htmlPath: string): UIModule | undefined;
  loadUIModuleFromText(htmlPath: string, htmlText: string, cssText: string, cssPathForFonts?: string): UIModule;
  getUIModule(htmlPath: string): UIModule | undefined;
  hasUIModule(htmlPath: string): boolean;
  allUIModules(): UIModule[];
  allLoweredUIModules(): Array<{ htmlPath: string; lowered: LoweredUI }>;

  // ── Entry-point UI detection ────────────────────────────────────────────
  markEntryHasUI(): void;
  entryHasUI(): boolean;
  clearEntryHasUI(): void;

  // ── Lowering ────────────────────────────────────────────────────────────
  lowerOnMount(htmlPath: string, opts: LowerOptions): LoweredUI;

  // ── Color resolution (used by IR transformers) ──────────────────────────
  resolveColor(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number;
  resolveColorInternal(input: string, format: "rgb565" | "rgb666" | "rgb888" | "mono"): number;

  // ── Runtime header emission ─────────────────────────────────────────────
  /**
   * Emits ONLY the CuttlefishGFX class definition (the shared GFX base for
   * native display paths). Called separately from emitRuntimeHeader so the
   * class can be emitted BEFORE display adapter declarations that
   * instantiate CuttlefishGFX by value. Returns "" when active is false
   * (console path).
   */
  emitCuttlefishGfx(active: boolean): string;

  /**
   * Options controlling runtime-header emission.
   *   - nativeDisplayActive: when true, emit the shared CuttlefishGFX class
   *     (used by native display adapters on AVR/ESP32). Arduino paths pass
   *     false (default) and use Adafruit_GFX directly.
   */
  emitRuntimeHeader(opts?: { nativeDisplayActive?: boolean }): string;

  // ── File splitting ──────────────────────────────────────────────────────
  splitUiFile(src: string): UiFileParts;

  // ── Image conversion ────────────────────────────────────────────────────
  /** Pre-decode src="…" image references (png/jpg/ico/…) into the RGB565
   *  asset cache. Must be awaited BEFORE loadUIModule/loadUIModuleFromText —
   *  the synchronous asset reader and natural-size layout read the cache. */
  warmUpImageDecoding(sourceText: string, baseDir: string, opts?: { maxW?: number; maxH?: number }): Promise<void>;

  // ── Type declaration generation ─────────────────────────────────────────
  generateProjectUITypeDeclarations(projectRoot: string): { written: string[]; errors: Array<{ filePath: string; error: Error }> };
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
