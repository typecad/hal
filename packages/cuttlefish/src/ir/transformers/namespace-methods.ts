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
    if (method === "in") {
      const pin = resolvePinArg(0);
      const level = resolveBoolArg(1);
      const timeout = argText(2);
      const call = timeout
        ? `pulseIn(${pin}, ${level}, ${timeout})`
        : `pulseIn(${pin}, ${level})`;
      return { emitLines: [], halOps: [], returnValue: call };
    }
    if (method === "long" || method === "long_") {
      const pin = resolvePinArg(0);
      const level = resolveBoolArg(1);
      const timeout = argText(2);
      const call = timeout
        ? `pulseInLong(${pin}, ${level}, ${timeout})`
        : `pulseInLong(${pin}, ${level})`;
      return { emitLines: [], halOps: [], returnValue: call };
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
    if (method === "seed") {
      return { emitLines: [`randomSeed(${argText(0)});`], halOps: [] };
    }
    if (method === "number") {
      const min = argText(0);
      const max = argText(1);
      return {
        emitLines: [],
        halOps: [],
        returnValue: max ? `random(${min}, ${max})` : `random(${min})`,
      };
    }
  }

  return null;
}
