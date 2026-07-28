import { describe, it, expect } from "vitest";
import { registerSafetyEngine } from "../../../packages/safety/src/engine-index";

// Unit tests for resolveSemanticCall's callee dispatch + literal-arg fallback.
// Pin-instance-identifier resolution depends on a CompilationContext being
// active (halInstances is a context-bound proxy), so it's verified end-to-end
// in tests/packages/safety/end-to-end.test.ts (Task 9), not here.
describe("safe.read lowering (v2 — unit tests)", () => {
  it("accepts a literal numeric pin as a fallback", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.read", [9]);
    expect(op).toMatchObject({ operation: "safety.read_safe", pin: 9 });
  });

  it("returns undefined for unknown callees", () => {
    const hook = registerSafetyEngine();
    expect(hook.resolveSemanticCall!("safe.unknown", [9])).toBeUndefined();
  });

  it("returns undefined for safe.pinMode (removed in v2)", () => {
    const hook = registerSafetyEngine();
    expect(hook.resolveSemanticCall!("safe.pinMode", [5, 0])).toBeUndefined();
  });

  it("returns undefined for safe.read with no args", () => {
    const hook = registerSafetyEngine();
    expect(hook.resolveSemanticCall!("safe.read", [])).toBeUndefined();
  });
});
