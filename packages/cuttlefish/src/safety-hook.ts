// ---------------------------------------------------------------------------
// Safety hook — the contract cuttlefish core uses to talk to the safety
// engine. Modeled on ui-hook.ts.
//
// The engine lives in this package (src/safety/engine.ts); transpile.ts calls
// loadSafetyEngine() at the start of each run, which registers an
// implementation of this interface. The seam is kept so the degradation paths
// (resetSafetyEngine / __simulateSafetyAbsentForTest) stay testable.
// ---------------------------------------------------------------------------

import type { HALOpIR, ProgramIR, RuntimePolyfillIR, Diagnostic } from "./api/shared/index.js";

/** Context handed to transformIR. */
export interface SafetyTransformContext {
  /** True iff the entry file imports `safe` from the safety authoring
   *  surface (@typecad/cuttlefish/safety, or legacy @typecad/safety). The
   *  pass uses this as a fast no-op guard. */
  readonly safetyInUse: boolean;
  /** Build target (e.g. "esp32", "avr"). Strategies still resolve the
   *  underlying pinMode/digitalRead symbols; the safety package is target-
   *  agnostic. */
  readonly target: string;
}

/** Capabilities cuttlefish core needs from the safety engine.
 *
 *  Part A uses transformIR + resolveSafetyOp + resolveSemanticCall.
 *  Part B (ISO 26262 Part 6 rules) adds analyzeIR; Part C (sidecar) will
 *  add collectSafetyMetadata. Both reuse this same seam with no new core
 *  machinery. */
export interface TranspilerSafetyHook {
  /** Post-build IR transform. Must return a (possibly new) ProgramIR. Part A
   *  uses this to inject safety.record_pin_mode companions after every
   *  gpio.pin_mode / safety.pin_mode op. Called only when hasSafetyHook(). */
  transformIR(program: ProgramIR, ctx: SafetyTransformContext): ProgramIR;

  /** Resolve a safety.* HAL op to C++ code or expression. Called from the
   *  extended routeHALOp() for any op whose `operation` starts with "safety.".
   *  NEVER delegated to a per-target strategy. Returns undefined if the op
   *  is not recognized (caller emits an unhandled-op warning). */
  resolveSafetyOp(op: HALOpIR): { code?: string; expression?: string } | undefined;

  /** Lower a safe.* TS call to a HAL op. Called from an extension point in
   *  tryResolveSemanticCall (hal-plugins.ts) when the callee resolves to the
   *  safety authoring surface. Returns undefined if not a safety call. */
  resolveSemanticCall?(callee: string, args: readonly unknown[]): HALOpIR | undefined;

  /** Provide safety runtime polyfills (mode table + voter). Called from
   *  buildEmitterContext so the polyfills participate in tree-shaking.
   *  Returns [] when safety is not in use. */
  buildPolyfills?(): RuntimePolyfillIR[];

  /** Part B: read-only ISO 26262 Part 6 software-rule analysis. Called
   *  after transformIR completes, on the final transformed IR. Returns
   *  diagnostics that flow into the build's diagnostic list. Diagnostics
   *  with severity "error" abort the build (via throwIfFatalDiagnostics);
   *  "warning"/"info" are logged but the build succeeds. */
  analyzeIR?(program: ProgramIR, ctx: SafetyTransformContext): Diagnostic[];

  /** Part C: collect safety metadata for sidecar artifact generation.
   *  Called after analyzeIR completes. Returns structured metadata about
   *  each safety-critical function (ASIL level, mechanisms, rule results)
   *  that the caller writes to a sidecar JSON file. */
  collectSafetyMetadata?(program: ProgramIR, ctx: SafetyTransformContext): SafetyMetadata[];
}

// ── Module-level hook state ────────────────────────────────────────────────

let safetyHook: TranspilerSafetyHook | null = null;

/** Set the safety hook. Called by transpile.ts after loading the safety
 *  engine. Passing null clears it. */
export function setSafetyHook(hook: TranspilerSafetyHook | null): void {
  safetyHook = hook;
}

/** Get the current safety hook, or null if the safety engine is not loaded. */
export function getSafetyHook(): TranspilerSafetyHook | null {
  return safetyHook;
}

/** Returns true if the safety hook is registered (i.e. safety engine loaded). */
export function hasSafetyHook(): boolean {
  return safetyHook !== null;
}

/** Get the safety hook, throwing if it's not set. Use only inside
 *  `if (hasSafetyHook())` guards. */
export function requireSafetyHook(): TranspilerSafetyHook {
  if (!safetyHook) {
    throw new Error(
      "Safety hook is not registered. This code path requires the safety " +
      "engine to be loaded. This should not happen — the hook is set " +
      "at the start of transpileFile() when safety is detected."
    );
  }
  return safetyHook;
}

// Re-export the types the safety package consumes (so the subpath export is
// self-contained).
export type { Diagnostic };

/** Metadata about one safety-critical function, collected for Part C. */
export interface SafetyFunctionMetadata {
  name: string;
  asilLevel: string;
  source?: { tsFile: string; tsLine: number };
  mechanisms: string[];
  rules: Record<string, "pass" | { severity: string; message: string }>;
}

/** Result of Part C's metadata collection. */
export interface SafetyMetadata {
  functions: SafetyFunctionMetadata[];
}
