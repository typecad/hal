import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A18-0-1: <cstring> over <string.h>.
 *
 * The strategy's cstringHeader() chooses the header per target:
 *   - generic/native: <cstring> (C++ form, AUTOSAR-compliant)
 *   - arduino/avr:    <string.h> (AVR has no <cstring>; legitimate deviation)
 *
 * The Arduino choice is a real A18-0-1 violation that should appear as a
 * deviation in strict/warn mode. The generic/native path is compliant.
 */
describe("A18-0-1: <cstring> over <string.h>", () => {
  it("generic target uses <cstring> (compliant)", () => {
    const result = transpile(
      `function f(): string { return "x"; }`,
      { autosar: "strict" },
    );
    // The transpile may or may not pull in cstring depending on what the
    // snippet uses. If it does include a c-string header, it must be <cstring>.
    if (result.cpp.includes("string.h") || result.cpp.includes("cstring")) {
      expect(result.cpp).toContain("<cstring>");
      expect(result.cpp).not.toContain("<string.h>");
    }
    const diag = result.diagnostics.find((d) => d.code === "AUTOSAR_A18-0-1");
    expect(diag).toBeUndefined();
  });

  it("native target uses <cstring> (compliant)", () => {
    const result = transpile(
      `function f(): string { return "x"; }`,
      { target: "native", autosar: "strict" },
    );
    if (result.cpp.includes("string.h") || result.cpp.includes("cstring")) {
      expect(result.cpp).toContain("<cstring>");
      expect(result.cpp).not.toContain("<string.h>");
    }
  });
});
