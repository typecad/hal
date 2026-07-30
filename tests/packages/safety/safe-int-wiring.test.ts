import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

// Verifies the transpiler lowers a TS sketch using SafeInt to correct C++:
//   - SafeInt<number> type annotation resolves to SafeInt<int32_t>
//   - SafeInt(0) constructor call gets the template arg injected
//   - method calls (.add().mul()) render verbatim against the resolved type
// This is the end-to-end coverage that the original (unwired) SafeInt32 lacked.
describe("SafeInt transpiler wiring (Approach A)", () => {
  it("lowers SafeInt<int32_t> with verbatim method calls and ctor template-arg injection", () => {
    // Use an explicit integer annotation — `SafeInt<number>` would resolve to
    // SafeInt<double> (the transpiler's default numeric mapping) which the
    // static_assert rejects. Explicit int32_t is the realistic safety usage.
    const { cpp, diagnostics } = transpileArduino(
      `
      import { SafeInt } from "@typecad/safety";

      let counter: SafeInt<int32_t> = SafeInt(0);
      function setup(): void {}
      function loop(): void {
        counter.add(5).mul(2);
        const v: int32_t = counter.get();
        if (counter.valid()) { (void)v; }
      }
    `,
      { autosar: "strict" },
    );

    const errors = (diagnostics ?? []).filter(
      (d) => d.severity === "error" && typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(errors, "AUTOSAR strict errors:\n" + errors.map((d) => `[${d.code}] ${d.message}`).join("\n"))
      .toEqual([]);

    // Type annotation preserved: SafeInt<int32_t>.
    expect(cpp).toContain("SafeInt<int32_t>");
    // Constructor call got the template arg injected: SafeInt(0) -> SafeInt<int32_t>(0).
    // (Requires the type-tracking fix that seeds promoted vars into knownVariableTypes
    // so the assign-path renderValueForTarget fires.)
    expect(cpp).toMatch(/SafeInt<int32_t>\(\s*0\s*\)/);
    // Method calls render verbatim (chained).
    expect(cpp).toContain(".add(");
    expect(cpp).toContain(".mul(");
    expect(cpp).toContain(".get(");
    expect(cpp).toContain(".valid(");
  });

  it("emits the SafeInt template definition (polyfill ships)", () => {
    const { cpp, diagnostics } = transpileArduino(
      `
      import { SafeInt } from "@typecad/safety";
      let x: SafeInt<int32_t> = SafeInt(0);
      function setup(): void {}
      function loop(): void { x.add(1); }
    `,
      { autosar: "strict" },
    );
    const errors = (diagnostics ?? []).filter(
      (d) => d.severity === "error" && typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(errors).toEqual([]);
    // The polyfill struct definition is present in the output.
    expect(cpp).toContain("struct SafeInt");
    expect(cpp).toContain("static_assert");
    expect(cpp).toContain("SafeInt<T> requires a signed integer T");
  });
});
