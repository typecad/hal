import { describe, it, expect, afterEach } from "vitest";
import { routeHALOp } from "../../../packages/cuttlefish/src/emit/route-hal-op";
import { setSafetyHook } from "../../../packages/cuttlefish/src/safety-hook";
import type { TranspilerSafetyHook } from "../../../packages/cuttlefish/src/safety-hook";

const fakeStrategy = {
  resolveHALOperation: () => ({ code: "/* from strategy */" }),
  resolveDisplayOp: () => ({ code: "/* from display */" }),
};

describe("routeHALOp safety.* prefix routing", () => {
  afterEach(() => setSafetyHook(null));

  it("dispatches safety.* ops to the safety hook when registered", () => {
    const hook: TranspilerSafetyHook = {
      transformIR: (p) => p,
      resolveSafetyOp: (op) => ({ code: `/* safety: ${(op as any).operation} */` }),
    };
    setSafetyHook(hook);

    const result = routeHALOp(
      { operation: "safety.record_pin_mode", pin: 5, mode: 0 },
      fakeStrategy as any,
    );
    expect(result?.code).toBe("/* safety: safety.record_pin_mode */");
  });

  it("leaves display.* routing unchanged", () => {
    setSafetyHook({
      transformIR: (p) => p,
      resolveSafetyOp: () => ({ code: "/* safety */" }),
    });
    const result = routeHALOp(
      { operation: "display.push" } as any,
      fakeStrategy as any,
    );
    expect(result?.code).toBe("/* from display */");
  });

  it("delegates non-prefixed ops to the strategy", () => {
    setSafetyHook({
      transformIR: (p) => p,
      resolveSafetyOp: () => ({ code: "/* safety */" }),
    });
    const result = routeHALOp(
      { operation: "gpio.write", pin: 5, value: 1 },
      fakeStrategy as any,
    );
    expect(result?.code).toBe("/* from strategy */");
  });

  it("returns undefined for safety.* when no hook is registered", () => {
    const result = routeHALOp(
      { operation: "safety.record_pin_mode", pin: 5, mode: 0 },
      fakeStrategy as any,
    );
    expect(result).toBeUndefined();
  });
});
