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
      return { code: `__tc_safety::record_pin_mode(${fields.pin}, ${fields.mode});` };
    case "safety.pin_mode":
      return { code: `pinMode(${fields.pin}, ${modeConstant(fields.mode as 0 | 1 | 2)}); __tc_safety::record_pin_mode(${fields.pin}, ${fields.mode});` };
    case "safety.read_safe":
      return { expression: `__tc_safety::read_safe(${fields.pin})` };
    default:
      return undefined;
  }
}

export function registerSafetyEngine(): TranspilerSafetyHook {
  return {
    transformIR: pinModeInterceptPass,
    resolveSafetyOp,
    buildPolyfills: buildSafetyPolyfills,
  };
}

export type { TranspilerSafetyHook };
