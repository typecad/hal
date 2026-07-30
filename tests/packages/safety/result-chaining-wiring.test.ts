import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

describe("safe.read().ok().fail() transpiler wiring", () => {
  it("lowers the chain with read_safe resolution + inline lambdas", () => {
    const { cpp, diagnostics } = transpileArduino(
      `
      import { Pin } from "@typecad/hal";
      import { safe } from "@typecad/safety";
      const btn = Pin.fromPort("PD2").asInput();
      function setup(): void {}
      function loop(): void {
        safe.read(btn)
          .ok(r => { (void) r.value; })
          .fail(r => { (void) r.code; });
      }
    `,
      { autosar: "warn" },
    );

    const errors = (diagnostics ?? []).filter((d) => d.severity === "error");
    expect(errors, "transpile errors:\n" + errors.map((d: any) => `[${d.code}] ${d.message}`).join("\n"))
      .toEqual([]);

    // safe.read resolved to the HAL expression.
    expect(cpp).toContain("__tc_safety::read_safe(");

    // Chain methods render as method calls on the result.
    expect(cpp).toContain(".ok(");
    expect(cpp).toContain(".fail(");

    // Lambdas render inline (capture [&], not hoisted to a named function).
    expect(cpp).toContain("[&]");
    expect(cpp).not.toContain("_isr_");
  });

  it("lowers safe.write().ok().fault() chains too", () => {
    const { cpp, diagnostics } = transpileArduino(
      `
      import { Pin } from "@typecad/hal";
      import { safe } from "@typecad/safety";
      const led = Pin.fromPort("PD13").asOutput();
      function setup(): void {}
      function loop(): void {
        safe.write(led, 1)
          .ok(r => {})
          .fault(r => {});
      }
    `,
      { autosar: "warn" },
    );
    const errors = (diagnostics ?? []).filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(cpp).toContain("__tc_safety::write_verify(");
    expect(cpp).toContain(".ok(");
    expect(cpp).toContain(".fault(");
    expect(cpp).toContain("[&]");
  });
});
