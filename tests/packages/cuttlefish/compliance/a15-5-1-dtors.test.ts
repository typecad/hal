import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A15-5-1: destructors must not throw.
 *
 * TypeCAD emits `virtual ~X() = default;` for every user class
 * (class-emitter.ts:311), which is implicitly noexcept. The 6 hand-written
 * destructors in display adapters and the generator shim are Track 3.
 *
 * This test freezes the user-class behavior: every emitted class dtor is
 * either `= default` or has an explicit `noexcept`. A regression would be
 * a hand-written throwing dtor, which would fail this test.
 */
describe("A15-5-1: user-class destructors are noexcept", () => {
  it("emits virtual ~X() = default for base classes (the only dtor emit case)", () => {
    // A destructor is only emitted when another class extends this one
    // (class-emitter.ts:315 — polymorphic bases need a virtual dtor). Simple
    // classes with no inheritors get no dtor at all.
    const ts = `
class Base { x: number = 1; }
class Derived extends Base { y: number = 2; }
`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).toMatch(/virtual\s+~Base\s*\(\s*\)\s*=\s*default/);
  });

  it("emits no AUTOSAR_A15-5-1 diagnostic for clean user classes", () => {
    const ts = `
class A { x: number = 1; }
class B extends A { y: string = "hi"; }
`;
    const result = transpile(ts, { autosar: "strict" });
    const diag = result.diagnostics.find((d) => d.code === "AUTOSAR_A15-5-1");
    expect(diag).toBeUndefined();
  });
});
