// The safety engine entry. The safety bridge (safety-bridge.ts) loads this
// module and calls registerSafetyEngine() to push a TranspilerSafetyHook
// implementation into the registry.
import type { HALOpIR } from "../api/index.js";
import type { TranspilerSafetyHook } from "../safety-hook.js";
import { pinModeInterceptPass } from "./passes/pinMode-intercept.js";
import { buildSafetyPolyfills } from "./runtime/polyfills.js";
import { halInstances } from "../ir/build-ir-state.js";
import { analyzeProgram } from "./iso26262/analyze.js";
import { collectSafetyMetadata } from "./iso26262/collect.js";

/** Resolve a safety.* HAL op to C++. MCU-agnostic: emits calls only to the
 *  safety package's own __tc_safety_* helpers (never to target-specific
 *  symbols like digitalRead). The strategy-injected __tc_gpio_read shim is
 *  called from inside the voter polyfill, not from here.
 *
 *  `op.operation` is a closed union in cuttlefish's HALOpIR that does NOT
 *  include safety.* ops (those are owned by this package). The dispatch in
 *  routeHALOp() uses string-prefix matching, so by the time we get here the
 *  operation is a safety.* string — cast to `string` so the switch is an
 *  open comparison. Field access goes through a generic record view because
 *  the safety op shapes are not part of the HALOpIR union. */
function resolveSafetyOp(op: HALOpIR): { code?: string; expression?: string } | undefined {
  const operation = op.operation as string;
  const fields = op as unknown as { pin?: unknown; mode?: unknown; value?: unknown };
  switch (operation) {
    case "safety.record_pin_mode":
      // mode is a TrackedMode enum value (numeric) — emitted as-is.
      return { code: `__tc_safety_record_pin_mode(${fields.pin}, ${fields.mode});` };
    case "safety.read_safe":
      return { expression: `__tc_safety::read_safe(${fields.pin})` };
    case "safety.write_verify":
      return { expression: `__tc_safety::write_verify(${fields.pin}, ${fields.value})` };
    default:
      return undefined;
  }
}

/** Resolve a Pin-instance argument to its pin number at IR time, using the
 *  same halInstances registry the HAL layer uses to resolve `this._pin`
 *  inside Pin method bodies. Returns undefined for args that aren't tracked
 *  Pin instances (the caller emits a diagnostic in that case). Also accepts
 *  literal numbers as a fallback (for code that constructs a Pin inline at
 *  the call site, e.g. safe.read(Pin.fromPort('PD2')) — though the idiomatic
 *  form is to assign the Pin to a local first). */
function resolvePinArg(arg: unknown): number | undefined {
  if (typeof arg === "number") return arg;
  if (typeof arg === "string") {
    // Identifier — look up in halInstances for a Pin instance with _pin.
    const inst = halInstances.get(arg);
    if (inst) {
      const pin = inst.fieldValues.get("_pin") ?? inst.fieldValues.get("pin");
      if (pin !== undefined) return Number(pin);
    }
  }
  return undefined;
}

/** Lower a safe.* TS call to a HAL op. Called from tryResolveSemanticCall
 *  (hal-plugins.ts) when the callee resolves to the @typecad/safety package. */
function resolveSemanticCall(callee: string, args: readonly unknown[]): HALOpIR | undefined {
  // `safe.read(Pin)` → safety.read_safe (pin resolved at IR time)
  if (callee === "safe.read") {
    const pin = resolvePinArg(args[0]);
    if (pin === undefined) return undefined;
    return { operation: "safety.read_safe", pin } as unknown as HALOpIR;
  }
  // `safe.write(OutputPin, value)` → safety.write_verify
  // value may be a number (literal) or string (rendered C++ expression text)
  if (callee === "safe.write") {
    const pin = resolvePinArg(args[0]);
    if (pin === undefined) return undefined;
    const value = args[1] ?? 0;
    return { operation: "safety.write_verify", pin, value } as unknown as HALOpIR;
  }
  return undefined;
}

export function registerSafetyEngine(): TranspilerSafetyHook {
  return {
    transformIR: pinModeInterceptPass,
    resolveSafetyOp,
    resolveSemanticCall,
    buildPolyfills: buildSafetyPolyfills,
    analyzeIR: analyzeProgram,
    collectSafetyMetadata,
  };
}

export type { TranspilerSafetyHook };
