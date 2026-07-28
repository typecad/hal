// The /engine subpath entry. cuttlefish dynamic-imports this module and calls
// registerSafetyEngine() to push a TranspilerSafetyHook implementation into
// its registry.
import type { HALOpIR } from "@typecad/cuttlefish/api";
import type { TranspilerSafetyHook } from "@typecad/cuttlefish/safety-hook-types";
import { modeConstant } from "./hal/ops.js";
import { pinModeInterceptPass } from "./passes/pinMode-intercept.js";
import { buildSafetyPolyfills } from "./runtime/polyfills.js";

/** Resolve a safety.* HAL op to C++. MCU-agnostic: only emits calls to
 *  pinMode() / __tc_safety::* — the standard Arduino symbols every strategy
 *  already lowers correctly for its target.
 *
 *  Note: `op.operation` is a closed union in cuttlefish's HALOpIR that does
 *  NOT include safety.* ops (those are owned by this package). The dispatch
 *  in routeHALOp() uses string-prefix matching, so by the time we get here
 *  the operation is a safety.* string — cast to `string` so the switch is an
 *  open comparison rather than an exhaustiveness check. Field access goes
 *  through a generic record view because the safety op shapes are not part
 *  of the HALOpIR union and cannot be cast directly. */
function resolveSafetyOp(op: HALOpIR): { code?: string; expression?: string } | undefined {
  const operation = op.operation as string;
  const fields = op as unknown as { pin?: unknown; mode?: unknown };
  switch (operation) {
    case "safety.record_pin_mode":
      return { code: `__tc_safety_record_pin_mode(${fields.pin}, ${fields.mode});` };
    case "safety.pin_mode":
      return { code: `pinMode(${fields.pin}, ${modeConstant(fields.mode as 0 | 1 | 2)}); __tc_safety_record_pin_mode(${fields.pin}, ${fields.mode});` };
    case "safety.read_safe":
      return { expression: `__tc_safety_read_safe(${fields.pin})` };
    default:
      return undefined;
  }
}

/** Lower a safe.* TS call to a HAL op. Called from an extension point in
 *  tryResolveSemanticCall (hal-plugins.ts) when the callee resolves to the
 *  @typecad/safety package. */
function resolveSemanticCall(callee: string, args: readonly unknown[]): HALOpIR | undefined {
  // `safe.read(pin)` → safety.read_safe
  if (callee === "safe.read") {
    const pin = args[0];
    if (typeof pin === "number") {
      return { operation: "safety.read_safe", pin } as unknown as HALOpIR;
    }
    return undefined;
  }
  // `safe.pinMode(pin, mode)` → safety.pin_mode
  // (the intercept pass will inject the record_pin_mode companion)
  if (callee === "safe.pinMode") {
    const pin = args[0];
    const mode = args[1];
    if (typeof pin === "number" && (mode === 0 || mode === 1 || mode === 2)) {
      return { operation: "safety.pin_mode", pin, mode } as unknown as HALOpIR;
    }
    return undefined;
  }
  return undefined;
}

export function registerSafetyEngine(): TranspilerSafetyHook {
  return {
    transformIR: pinModeInterceptPass,
    resolveSafetyOp,
    resolveSemanticCall,
    buildPolyfills: buildSafetyPolyfills,
  };
}

export type { TranspilerSafetyHook };
