import { describe, it, expect } from "vitest";
import { registerSafetyEngine } from "../../../packages/safety/src/engine-index";

describe("safe.read lowering", () => {
  it("resolveSemanticCall lowers safe.read to safety.read_safe", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.read", [9]);
    expect(op).toMatchObject({ operation: "safety.read_safe", pin: 9 });
  });

  it("returns undefined for unknown callees", () => {
    const hook = registerSafetyEngine();
    expect(hook.resolveSemanticCall!("safe.unknown", [9])).toBeUndefined();
  });

  it("returns undefined for safe.read with non-number pin", () => {
    const hook = registerSafetyEngine();
    expect(hook.resolveSemanticCall!("safe.read", ["not a number"])).toBeUndefined();
  });

  it("resolves safe.pinMode to safety.pin_mode", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.pinMode", [5, 0]);
    expect(op).toMatchObject({ operation: "safety.pin_mode", pin: 5, mode: 0 });
  });
});
