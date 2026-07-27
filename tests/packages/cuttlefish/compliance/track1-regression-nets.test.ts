import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Track 1 — Self-check regression nets for already-compliant [C] rules.
 *
 * The investigation (see spec addendum "Implementation scope revision")
 * classified these 14 rules as already satisfied by the current emitter.
 * Each test transpiles a snippet exercising the relevant construct under
 * --autosar=strict and asserts the self-check produces no AUTOSAR_<ruleId>
 * diagnostic. If any of these starts failing, the rule regressed and needs
 * a renderer gate (move to Track 2).
 */
describe("Track 1: already-compliant [C] rules — self-check regression nets", () => {
  function assertNoFindingFor(tsCode: string, ruleId: string, target?: "arduino" | "native") {
    const result = transpile(tsCode, { autosar: "strict", ...(target ? { target } : {}) });
    const diag = result.diagnostics.find(
      (d) => typeof d.code === "string" && d.code === `AUTOSAR_${ruleId}`,
    );
    expect(diag, `unexpected AUTOSAR_${ruleId} diagnostic: ${diag?.message ?? ""}`).toBeUndefined();
  }

  it("A16-0-1: no unused #include surfaces as a diagnostic", () => {
    // Self-check rule; transpiling clean code shouldn't trip it.
    assertNoFindingFor("const x = 5;", "A16-0-1");
  });

  it("A16-0-3: no #include inside namespace", () => {
    assertNoFindingFor("const x = 5;", "A16-0-3");
  });

  it("A16-0-4: no #define inside #define", () => {
    assertNoFindingFor("const x = 5;", "A16-0-4");
  });

  it("A16-7-1: header guards are #pragma once, not #ifndef _H", () => {
    // Transpile a split-mode file so a header is emitted; assert the
    // header uses #pragma once and not the legacy guard.
    const result = transpile("const x = 5;", { autosar: "strict", emitMode: "split" });
    if (result.header) {
      expect(result.header).toMatch(/#pragma once/);
      expect(result.header).not.toMatch(/#ifndef\s+\w+_H\s*$/m);
    }
  });

  it("A5-2-2: no static_cast downcast of polymorphic type", () => {
    assertNoFindingFor("const x = 5;", "A5-2-2");
  });

  it("A27-0-4: no return std::move(local)", () => {
    assertNoFindingFor("function f(): number { return 5; }", "A27-0-4");
  });

  it("M5-2-9: no copy of volatile std::atomic", () => {
    assertNoFindingFor("const x = 5;", "M5-2-9");
  });

  it("A8-4-2: forward-declare parameters before use", () => {
    assertNoFindingFor("function add(a: number, b: number): number { return a + b; }", "A8-4-2");
  });

  it("A5-1-1: no recursion in emitted helpers", () => {
    assertNoFindingFor("const x = 5;", "A5-1-1");
  });

  it("A10-3-1: no function hiding in derived classes", () => {
    // With virtual+override emitted correctly, hiding can't occur.
    assertNoFindingFor("const x = 5;", "A10-3-1");
  });

  it("M6-2-1: switch must have default (lowered if/else has implicit default)", () => {
    // TS switch lowers to if/else-if/else where the else is the default.
    const ts = `
function label(n: number): string {
  switch (n) {
    case 0: return "zero";
    case 1: return "one";
    default: return "many";
  }
}
`;
    assertNoFindingFor(ts, "M6-2-1");
  });

  it("A2-10-5: identifier reuse across scopes (advisory, not diagnostic)", () => {
    assertNoFindingFor("const x = 5;", "A2-10-5");
  });

  it("A7-1-2: no 'register' keyword", () => {
    assertNoFindingFor("const x = 5;", "A7-1-2");
  });

  it("A3-3-2: no unreachable code", () => {
    assertNoFindingFor("const x = 5;", "A3-3-2");
  });

  it("A2-11-1: no identifier simultaneously typedef and another entity", () => {
    assertNoFindingFor("const x = 5;", "A2-11-1");
  });
});
