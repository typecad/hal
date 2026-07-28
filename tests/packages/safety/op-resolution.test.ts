import { describe, it, expect } from "vitest";
import { registerSafetyEngine } from "../../../packages/safety/src/engine-index";

describe("resolveSafetyOp", () => {
  const hook = registerSafetyEngine();

  it("resolves safety.record_pin_mode to record_pin_mode + semicolon", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.record_pin_mode", pin: 5, mode: 0 });
    expect(result?.code).toBe("__tc_safety_record_pin_mode(5, 0);");
  });

  it("resolves safety.pin_mode to pinMode + record_pin_mode", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.pin_mode", pin: 7, mode: 1 });
    expect(result?.code).toBe("pinMode(7, OUTPUT); __tc_safety_record_pin_mode(7, 1);");
  });

  it("resolves safety.read_safe to a read_safe expression", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.read_safe", pin: 9 });
    expect(result?.expression).toBe("__tc_safety_read_safe(9)");
  });

  it("returns undefined for unknown ops", () => {
    const result = hook.resolveSafetyOp({ operation: "safety.unknown" });
    expect(result).toBeUndefined();
  });
});
