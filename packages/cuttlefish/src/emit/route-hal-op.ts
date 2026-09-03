// ---------------------------------------------------------------------------
// Op routing — dispatch a HALOpIR to the right strategy resolver.
//
// display.* ops go to resolveDisplayOp (graphics-specific).
// safety.*  ops go to the safety hook's resolveSafetyOp (when @typecad/safety
//           is loaded) — NEVER to a per-target strategy, because the safety
//           package is MCU-agnostic by construction.
// everything else goes to resolveHALOperation (the existing generic seam).
// Keeps the consumer sites (expression-renderer, statement-renderer,
// render-expr) DRY.
//
// Output-pin state tracking is also handled here, centrally, so every
// strategy benefits without per-strategy changes:
// - (pin-state-tracking removed: every gpio.* op lowers through the strategy)
//   update appended to whatever the strategy produced. The flag is baked
//   into the op at IR-build time (markShadowUpdatingOps) — emit must not
//   consult live tracker state, because all files build (each resetting the
//   tracker) before any file emits.
// ---------------------------------------------------------------------------

import type { HALOpIR, PlatformStrategy } from "../api/shared/index.js";
import { getSafetyHook } from "../safety-hook.js";
import { markHalOpResolved } from "../ir/build-ir-state.js";

export function routeHALOp(
  op: HALOpIR,
  strategy: Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp">,
): { code?: string; expression?: string } | undefined {
  // An op resolved here during IR-build-time method inlining may never exist
  // as an IR node (its text is baked into the calling method's emit lines),
  // so record it for program-analysis's peripheral usage flags — every
  // branch, matching the IR-node paths (display.* sets usesGPIO/usesDisplay,
  // safety.* maps the __tc_safety_* helpers).
  if (typeof op.operation === "string") {
    if (op.operation.startsWith("display.")) {
      const r = strategy.resolveDisplayOp?.(op as Extract<HALOpIR, { operation: `display.${string}` }>);
      if (r) markHalOpResolved(op.operation);
      return r;
    }
    if (op.operation.startsWith("safety.")) {
      // Safety ops are resolved by the @typecad/safety package via hook.
      // Returns undefined if the package is not loaded (caller emits an
      // unhandled-op warning).
      const r = getSafetyHook()?.resolveSafetyOp?.(op);
      if (r) markHalOpResolved(op.operation);
      return r;
    }
  }

  const resolved = strategy.resolveHALOperation?.(op);
  if (resolved) markHalOpResolved(op.operation);
  return resolved;
}
