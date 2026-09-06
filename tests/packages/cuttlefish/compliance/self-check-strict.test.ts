import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Task 2.7 — End-to-end strict-mode contract.
 *
 * The core invariant of the compliance system, exercised through the full
 * transpile pipeline (not just unit tests of the module):
 *
 *   Clean code under --autosar=strict produces NO AUTOSAR_* diagnostics.
 *
 * (The former companions here triggered a framework-arduino serial-helper
 * C-style cast via console.log; that framework and the console lowering are
 * both gone, so no pipeline-visible violation trigger remains. The
 * rule-engine and per-rule suites cover the violation path directly.)
 */
describe("self-check end-to-end under autosar=strict", () => {
  it("clean numeric code produces no AUTOSAR_* diagnostics", () => {
    const result = transpile("const x = 5; const y = x + 1;", { autosar: "strict" });
    const autosarDiags = result.diagnostics.filter(
      (d) => typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });

  it("clean user-class code produces no AUTOSAR_* diagnostics", () => {
    const ts = `
class Base { x: number = 1; }
class Derived extends Base { y: number = 2; }
`;
    const result = transpile(ts, { autosar: "strict" });
    const autosarDiags = result.diagnostics.filter(
      (d) => typeof d.code === "string" && d.code.startsWith("AUTOSAR_"),
    );
    expect(autosarDiags).toEqual([]);
  });
});
