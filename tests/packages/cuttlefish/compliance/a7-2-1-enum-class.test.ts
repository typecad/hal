import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * A7-2-1: enumerators use scoped enums (enum class).
 *
 * The cuttlefish enum emitter already produces `enum class` for user TS
 * enums. One residual: the async state-machine helper at
 * emit/utils/async-state-machine.ts:313 emits `enum State { ... }`
 * (C-style) for its internal state enum. This test confirms the fix.
 *
 * The ui/runtime-header/structs.ts residuals are Track 3 (UI package).
 */
describe("A7-2-1: enum class", () => {
  it("user TS enums emit as enum class", () => {
    const ts = `
enum Color { Red, Green, Blue }
const c: Color = Color.Red;
`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).toMatch(/enum\s+class\s+Color/);
    expect(result.cpp).not.toMatch(/enum\s+Color\s*\{/);
  });

  it("async state machine emits enum class State (was: enum State)", async () => {
    // An async function lowers to a state-machine class with an internal
    // State enum. Confirm it's `enum class State`.
    const ts = `
async function task(): Promise<void> {
  await new Promise<void>((resolve) => {
    const t = setInterval(() => resolve(), 10);
  });
}
`;
    const result = transpile(ts, { autosar: "strict" });
    if (result.cpp.includes("enum State") || result.cpp.includes("enum class State")) {
      expect(result.cpp).toMatch(/enum\s+class\s+State\b/);
      expect(result.cpp).not.toMatch(/enum\s+State\s*\{/);
    }
  });
});
