import { ExpressionIR, HALOpIR } from "../../api/index.js";
import { renderExprAsText } from "../render-expr.js";
import { halInstances } from "../hal-resolver.js";

export type NamespaceMethodResult = {
  emitLines: string[];
  halOps: HALOpIR[];
  returnValue?: string;
} | null;

/**
 * Resolve a Pulse, Shift, or Random namespace method call to its C++ equivalent.
 *
 * These methods are handled as inline fallbacks because they don't map to
 * HAL class instances — they are free-standing Arduino API functions accessed
 * through TypeCAD namespace objects.
 *
 * @param ns       - The namespace identifier text ("Pulse", "Shift", "Random")
 * @param method   - The method name (e.g. "in", "out", "seed", "number")
 * @param argIRs   - Pre-built ExpressionIR for each call argument
 * @returns A result object compatible with both statement and expression contexts,
 *          or null if the ns/method combination is not recognized.
 */
export function resolveNamespaceMethodCall(
  ns: string,
  method: string,
  argIRs: ExpressionIR[],
): NamespaceMethodResult {
  const argText = (idx: number): string => {
    const a = argIRs[idx];
    if (!a) return "";
    return renderExprAsText(a);
  };

  const resolvePinArg = (idx: number): string => {
    const text = argText(idx);
    const inst = halInstances.get(text);
    if (inst && inst.fieldValues.has("_pin")) return inst.fieldValues.get("_pin")!;
    return text;
  };

  const resolveBoolArg = (idx: number): string => {
    const text = argText(idx);
    if (text === "true") return "HIGH";
    if (text === "false") return "LOW";
    return text;
  };

  if (ns === "Pulse") {
    // Legacy free-function style: Pulse.in(pin, level)
    if (method === "in") {
      const pin = resolvePinArg(0);
      const level = resolveBoolArg(1);
      const timeout = argText(2);
      const call = timeout
        ? `pulseIn(${pin}, ${level}, ${timeout})`
        : `pulseIn(${pin}, ${level})`;
      return { emitLines: [], halOps: [], returnValue: call };
    }
    // Current fluent API: Pulse.on(pin) returns a PulseMeasurement builder.
    // The builder methods (.high(), .low(), .timeout()) are chained, so we
    // can't resolve them here — but the static Pulse.long() can be handled.
    if (method === "long" || method === "long_") {
      const pin = resolvePinArg(0);
      const level = resolveBoolArg(1);
      const timeout = argText(2);
      const call = timeout
        ? `pulseInLong(${pin}, ${level}, ${timeout})`
        : `pulseInLong(${pin}, ${level})`;
      return { emitLines: [], halOps: [], returnValue: call };
    }
    // Pulse.long(pin, value) static method (current API)
    if (method === "long") {
      const pin = resolvePinArg(0);
      const value = argText(1);
      return { emitLines: [], halOps: [], returnValue: `pulseInLong(${pin}, ${value})` };
    }
  }

  if (ns === "Shift") {
    if (method === "in") {
      return {
        emitLines: [],
        halOps: [],
        returnValue: `shiftIn(${resolvePinArg(0)}, ${resolvePinArg(1)}, ${argText(2)})`,
      };
    }
    if (method === "out") {
      return {
        emitLines: [`shiftOut(${resolvePinArg(0)}, ${resolvePinArg(1)}, ${argText(2)}, ${argText(3)});`],
        halOps: [],
      };
    }
  }

  if (ns === "Random") {
    // Random.* lowers to the random.* HAL op family, which frameworks lower to
    // their platform PRNG (e.g. Zephyr's sys_rand).
    // Previously these emitted bare `random()`/`randomSeed()` calls, which only
    // resolve to symbols on Arduino-core frameworks — on ESP-IDF they were
    // undefined and failed at C++ link time.
    if (method === "seed") {
      return { emitLines: [], halOps: [{ operation: "random.seed", seed: argText(0) }] };
    }
    if (method === "number") {
      const min = argText(0);
      const max = argText(1);
      if (max) {
        return { emitLines: [], halOps: [{ operation: "random.range", min, max }], returnValue: "__hal_op_return__" };
      }
      // Single-arg form: Random.number(max) → [0, max-1]
      return { emitLines: [], halOps: [{ operation: "random.range", min: "0", max: min }], returnValue: "__hal_op_return__" };
    }
    // Random.upTo(max) → [0, max-1]
    if (method === "upTo") {
      return { emitLines: [], halOps: [{ operation: "random.range", min: "0", max: argText(0) }], returnValue: "__hal_op_return__" };
    }
    // Random.between(min, max) → [min, max-1]
    if (method === "between") {
      return { emitLines: [], halOps: [{ operation: "random.range", min: argText(0), max: argText(1) }], returnValue: "__hal_op_return__" };
    }
    // Random.int() → non-negative 31-bit integer
    if (method === "int") {
      return { emitLines: [], halOps: [{ operation: "random.int" }], returnValue: "__hal_op_return__" };
    }
  }


  return null;
}
