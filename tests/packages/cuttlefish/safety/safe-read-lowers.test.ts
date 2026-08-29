import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSafetyEngine } from "../../../../packages/cuttlefish/src/safety/engine";
// IMPORTANT: import halInstances from the SAME module path the safety engine
// uses — the engine now imports it relatively from src, so this test does too.
// Separate module instances would create separate globalDefaultContext maps
// and make test writes invisible to the engine's reads.
import { halInstances } from "../../../../packages/cuttlefish/src/ir/build-ir-state";

// Unit tests for resolveSemanticCall's callee dispatch + literal-arg fallback,
// plus resolvePinArg coverage for Pin-instance identifiers. The identifier
// path uses halInstances, which (when no AsyncLocalStorage context is active,
// as in unit tests) resolves against the global default context.
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

describe("resolvePinArg (Pin-instance identifier resolution)", () => {
  // Register + clean up a fake Pin instance so these tests don't bleed into
  // each other or other suites that share the global default context.
  const PIN_NAME = "__t3_test_pin";
  beforeEach(() => {
    halInstances.set(PIN_NAME, {
      className: "Pin",
      fieldValues: new Map([["_pin", "42"]]),
    } as any);
  });
  afterEach(() => {
    halInstances.delete(PIN_NAME);
  });

  it("resolves a Pin-instance identifier to its _pin field", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.read", [PIN_NAME]) as any;
    expect(op).toBeDefined();
    expect(op.operation).toBe("safety.read_safe");
    expect(op.pin).toBe(42);
  });

  it("returns undefined for an untracked identifier (no diagnostic silently)", () => {
    const hook = registerSafetyEngine();
    // 'unknownPin' is not in halInstances → resolvePinArg returns undefined.
    const op = hook.resolveSemanticCall!("safe.read", ["unknownPin"]);
    expect(op).toBeUndefined();
  });

  it("falls back to literal numeric arg when given a number, not an identifier", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.read", [77]) as any;
    expect(op).toBeDefined();
    expect(op.pin).toBe(77);
  });

  it("resolves via the 'pin' field name as a fallback when '_pin' is absent", () => {
    halInstances.set(PIN_NAME, {
      className: "Pin",
      fieldValues: new Map([["pin", "13"]]),
    } as any);
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.read", [PIN_NAME]) as any;
    expect(op.pin).toBe(13);
  });
});

// safe.write value handling: value may be a number literal or a string of
// rendered C++ expression text.
describe("safe.write lowering", () => {
  it("lowers safe.write(OutputPin, value) to safety.write_verify with numeric value", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.write", [5, 1]) as any;
    expect(op).toMatchObject({ operation: "safety.write_verify", pin: 5, value: 1 });
  });

  it("accepts a string value (rendered C++ expression text)", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.write", [5, "r.value"]) as any;
    expect(op).toMatchObject({ operation: "safety.write_verify", pin: 5, value: "r.value" });
  });

  it("defaults value to 0 when omitted", () => {
    const hook = registerSafetyEngine();
    const op = hook.resolveSemanticCall!("safe.write", [5]) as any;
    expect(op).toMatchObject({ operation: "safety.write_verify", pin: 5, value: 0 });
  });
});
