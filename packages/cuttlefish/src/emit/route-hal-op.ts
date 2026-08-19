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
// - gpio.read with `trackedValue` never reaches the strategy (a hardware
//   read of a direction-only output is not portable, e.g. Zephyr); it folds
//   to a constant or the tracked shadow variable.
// - gpio.write / gpio.toggle flagged `updatesShadow` get the shadow variable
//   update appended to whatever the strategy produced. The flag is baked
//   into the op at IR-build time (markShadowUpdatingOps) — emit must not
//   consult live tracker state, because all files build (each resetting the
//   tracker) before any file emits.
// ---------------------------------------------------------------------------

import type { HALOpIR, PlatformStrategy } from "../api/shared/index.js";
import { getSafetyHook } from "../safety-hook.js";
import { pinShadowVarName } from "../ir/pin-state-tracking.js";

export function routeHALOp(
  op: HALOpIR,
  strategy: Pick<PlatformStrategy, "resolveHALOperation" | "resolveDisplayOp">,
): { code?: string; expression?: string } | undefined {
  if (typeof op.operation === "string") {
    if (op.operation.startsWith("display.")) {
      return strategy.resolveDisplayOp?.(op as Extract<HALOpIR, { operation: `display.${string}` }>);
    }
    if (op.operation.startsWith("safety.")) {
      // Safety ops are resolved by the @typecad/safety package via hook.
      // Returns undefined if the package is not loaded (caller emits an
      // unhandled-op warning).
      return getSafetyHook()?.resolveSafetyOp?.(op);
    }
  }

  if (op.operation === "gpio.read" && op.trackedValue) {
    // Tracked OUTPUT-pin read: software truth, never a hardware read.
    if (op.trackedValue === "high") return { expression: "true" };
    if (op.trackedValue === "low") return { expression: "false" };
    return { expression: pinShadowVarName(op.pin) };
  }

  const resolved = strategy.resolveHALOperation?.(op);

  // Toggle on a shadow-tracked pin must not use the strategy's default
  // read-modify-write form (e.g. digitalWrite(p, digitalRead(p) ...) on
  // Arduino) — reading the pin back is exactly what tracking avoids. Lower
  // it as a write of the shadow's current value, then flip the shadow.
  if (op.operation === "gpio.toggle" && op.updatesShadow) {
    const varName = pinShadowVarName(op.pin);
    const writeOp = {
      operation: "gpio.write",
      pin: op.pin,
      value: varName,
      ...(op.port !== undefined ? { port: op.port } : {}),
    } as HALOpIR;
    const writeResolved = strategy.resolveHALOperation?.(writeOp);
    const flip = `${varName} = (!${varName});`;
    if (writeResolved?.code) {
      return { ...writeResolved, code: `${writeResolved.code}\n${flip}` };
    }
    if (writeResolved?.expression) {
      return { ...writeResolved, expression: `${writeResolved.expression}, ${flip}` };
    }
    return { code: flip };
  }

  if (op.operation === "gpio.write" && op.updatesShadow) {
    const varName = pinShadowVarName(op.pin);
    const update = `${varName} = ((${op.value}) != 0);`;
    if (resolved?.code) {
      return { ...resolved, code: `${resolved.code}\n${update}` };
    }
    if (resolved?.expression) {
      return { ...resolved, expression: `${resolved.expression}, ${update}` };
    }
    return { code: update };
  }

  return resolved;
}
