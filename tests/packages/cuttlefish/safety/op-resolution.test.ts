import { describe, it, expect } from "vitest";
import { registerSafetyEngine } from "../../../../packages/cuttlefish/src/safety/engine";
import { TrackedMode } from "../../../../packages/cuttlefish/src/safety/hal/ops";

describe("resolveSafetyOp (v2)", () => {
  const hook = registerSafetyEngine();

  it("resolves safety.record_pin_mode with numeric TrackedMode value", () => {
    const result = hook.resolveSafetyOp({
      operation: "safety.record_pin_mode",
      pin: 5,
      mode: TrackedMode.Input,
    } as any);
    expect(result?.code).toBe(`__tc_safety_record_pin_mode(5, ${TrackedMode.Input});`);
  });

  it("resolves safety.read_safe to a read_safe expression", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.read_safe", pin: 9 } as any);
    expect(result?.expression).toBe("__tc_safety::read_safe(9)");
  });

  it("returns undefined for unknown ops", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.unknown" } as any);
    expect(result).toBeUndefined();
  });

  it("returns undefined for safety.pin_mode (removed in v2)", () => {
    // safety.pin_mode no longer exists — verify it falls through.
    const result = hook.resolveSafetyOp({ operation: "safety.pin_mode", pin: 5, mode: 0 } as any);
    expect(result).toBeUndefined();
  });
});
