import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A6-5-1 (single loop variable) + M6-4-3 (for condition must be finite).
 *
 * The TS for-statement already has single-initializer semantics, so A6-5-1
 * is structurally satisfied. M6-4-3 is the more interesting one: a TS
 * `for(;;)` would lower to a C++ `for(;;)` (infinite loop with empty
 * condition) which AUTOSAR flags. The rule is advisory-to-required; this
 * test documents the current behavior under autosar=strict.
 */
describe("A6-5-1 / M6-4-3: loop lowering under autosar", () => {
  it("A6-5-1: a normal for loop with a single loop variable emits cleanly", () => {
    const ts = `
let sum = 0;
for (let i = 0; i < 10; i++) { sum = sum + i; }
`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).toMatch(/for\s*\(/);
    // No AUTOSAR_A6-5-1 diagnostic.
    const diag = result.diagnostics.find((d) => d.code === "AUTOSAR_A6-5-1");
    expect(diag).toBeUndefined();
  });

  it("M6-4-3: a TS while(true) is permitted (explicit finite-intent spelling)", () => {
    // while(true) is the standard idiom and is not flagged by the self-check
    // (the detect regex for M6-4-3 isn't in the rule table — this rule is
    // enforced structurally, only blocked if the renderer emits `for(;;)`).
    const ts = `
let i = 0;
while (true) { i = i + 1; if (i > 5) break; }
`;
    const result = transpile(ts, { autosar: "strict" });
    const diag = result.diagnostics.find((d) => d.code === "AUTOSAR_M6-4-3");
    expect(diag).toBeUndefined();
  });

  it("A6-5-1: a for-of loop (range-for) is single-variable and clean", () => {
    const ts = `
const arr: number[] = [1, 2, 3];
let s = 0;
for (const v of arr) { s = s + v; }
`;
    const result = transpile(ts, { autosar: "strict" });
    const diag = result.diagnostics.find((d) => d.code === "AUTOSAR_A6-5-1");
    expect(diag).toBeUndefined();
  });
});
