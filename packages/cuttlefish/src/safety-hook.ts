// ---------------------------------------------------------------------------
// Safety hook — the contract cuttlefish core uses to talk to the optional
// @typecad/safety package. Modeled on ui-hook.ts.
//
// @typecad/safety is an optional peer dependency. When it is installed and
// imported by a sketch, transpile.ts calls loadSafetyEngine() which dynamic-
// imports @typecad/safety/engine and calls registerSafetyEngine() to push an
// implementation of this interface into the registry. When absent, every
// hasSafetyHook() guard returns false and cuttlefish behaves as before.
// ---------------------------------------------------------------------------

import type { HALOpIR, ProgramIR, RuntimePolyfillIR, Diagnostic } from "./api/shared/index.js";

/** Context handed to transformIR. */
export interface SafetyTransformContext {
  /** True iff the entry file imports `safe` from @typecad/safety. The pass
   *  uses this as a fast no-op guard. */
  readonly safetyInUse: boolean;
  /** Build target (e.g. "esp32", "avr"). Strategies still resolve the
   *  underlying pinMode/digitalRead symbols; the safety package is target-
   *  agnostic. */
  readonly target: string;
}

/** Capabilities cuttlefish core needs from the safety engine.
 *
 *  Part A uses transformIR + resolveSafetyOp + resolveSemanticCall.
 *  Part B (ISO 26262 Part 6 rules) will add analyzeIR; Part C (sidecar) will
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
   *  @typecad/safety package. Returns undefined if not a safety call. */
  resolveSemanticCall?(callee: string, args: readonly unknown[]): HALOpIR | undefined;

  /** Provide safety runtime polyfills (mode table + voter). Called from
   *  buildEmitterContext so the polyfills participate in tree-shaking.
   *  Returns [] when safety is not in use. */
  buildPolyfills?(): RuntimePolyfillIR[];
}

// ── Module-level hook state ────────────────────────────────────────────────

let safetyHook: TranspilerSafetyHook | null = null;

/** Set the safety hook. Called by transpile.ts after dynamically loading
 *  @typecad/safety/engine. Passing null clears it. */
export function setSafetyHook(hook: TranspilerSafetyHook | null): void {
  safetyHook = hook;
}

/** Get the current safety hook, or null if @typecad/safety is not loaded. */
export function getSafetyHook(): TranspilerSafetyHook | null {
  return safetyHook;
}

/** Returns true if the safety hook is registered (i.e. @typecad/safety loaded). */
export function hasSafetyHook(): boolean {
  return safetyHook !== null;
}

/** Get the safety hook, throwing if it's not set. Use only inside
 *  `if (hasSafetyHook())` guards. */
export function requireSafetyHook(): TranspilerSafetyHook {
  if (!safetyHook) {
    throw new Error(
      "Safety hook is not registered. This code path requires @typecad/safety " +
      "to be installed and loaded. This should not happen — the hook is set " +
      "at the start of transpileFile() when safety is detected."
    );
  }
  return safetyHook;
}

// Re-export the types the safety package consumes (so the subpath export is
// self-contained).
export type { Diagnostic };
