// The /engine subpath entry. cuttlefish dynamic-imports this module and calls
// registerSafetyEngine() to push a TranspilerSafetyHook implementation into
// its registry. Minimal stub here — Task 11 fills in the real impl.
import type { TranspilerSafetyHook } from "@typecad/cuttlefish/safety-hook-types";

export function registerSafetyEngine(): TranspilerSafetyHook {
  return {
    transformIR: (program) => program, // no-op until Task 10
    resolveSafetyOp: () => undefined,  // no-op until Task 7
  };
}

export type { TranspilerSafetyHook };
