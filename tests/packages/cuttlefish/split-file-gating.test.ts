import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

describe("split-file header gating (unified entry/non-entry path)", () => {
  it("a program that uses `?? null` lowering gets the cuttlefish_nullish helper", () => {
    // `x ?? null` lowers to cuttlefish_nullish(x, nullptr). The helper must be
    // present in the output. (Pre-render usesNullishHelper detection + the
    // post-render header injection in output-finalizer.ts cover this.)
    const result = transpile(`
      let x: number | null = null;
      export function f(): number { return (x ?? null) ?? 0; }
    `, { target: "arduino" });
    // The nullish helper or its call must appear somewhere in the output.
    // (It may be inlined as a raw call even if the helper fn is guarded.)
    expect(result.cpp).toMatch(/cuttlefish_nullish|typecad_nullish/);
  });

  it("a program with no I2C usage does not emit Wire/I2C shim code", () => {
    // Gating should strip unused peripheral shims. A program using only a
    // digital pin (no Wire/I2C) should not contain I2C transmission code.
    const result = transpile(`
      import { D2 } from "@typecad/board-arduino-uno";
      D2.asOutput();
    `, { target: "arduino" });
    expect(result.cpp).not.toContain("Wire.beginTransmission");
  });

  it("a program with no EEPROM usage does not emit EEPROM shim code", () => {
    const result = transpile(`
      import { D2 } from "@typecad/board-arduino-uno";
      D2.asOutput();
    `, { target: "arduino" });
    expect(result.cpp).not.toContain("EEPROM.read");
  });
});
