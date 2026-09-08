import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A3-9-1: fixed-width integers (uint32_t not unsigned int, int32_t not int).
 *
 * TypeCAD's defaultNumericType() returns "int" for TS `number`. Under
 * --autosar, this should flip to "int32_t" so emitted code uses fixed-width
 * integers throughout (the AUTOSAR-required form). Default-off preserves
 * "int" so existing output is byte-identical.
 */
describe("A3-9-1: fixed-width integers under autosar", () => {
  it("user number variables emit as int32_t (not int) under autosar=strict", () => {
    const result = transpile("const x = 5;", { autosar: "strict" });
    expect(result.cpp).toMatch(/\bint32_t\s+x/);
    expect(result.cpp).not.toMatch(/(^|[^_\w])int\s+x\b/);
  });

  it("default-off preserves the legacy 'int' spelling", () => {
    const result = transpile("const x = 5;");
    expect(result.cpp).toMatch(/(^|[^_\w])int\s+x\b/);
    expect(result.cpp).not.toMatch(/\bint32_t\s+x/);
  });

  it("for-loop index variables use int32_t under autosar", () => {
    const ts = `let s = 0; for (let i = 0; i < 10; i++) { s = s + i; }`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).toMatch(/\bint32_t\s+i/);
  });
});
