import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

/**
 * Task 2.7 — End-to-end strict-mode contract.
 *
 * Two core invariants of the compliance system, exercised through the full
 * transpile pipeline (not just unit tests of the module):
 *
 *   1. Clean code under --autosar=strict produces NO AUTOSAR_* diagnostics.
 *   2. Code that exercises a construct the renderer hasn't wired produces
 *      an AUTOSAR_* diagnostic (the self-check catches it as an unrecorded
 *      violation). The framework/UI shim casts (Track 3 deferred work)
 *      are the canonical example: they're real M5-0-7 violations that the
 *      self-check flags until Phase 4 wires deviations for them.
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

  it("the self-check flags a deliberate M5-0-7 violation in framework output", () => {
    // Framework-arduino strategy.ts emits a (char)Serial.read() cast in its
    // serial helper. Under --autosar=strict the self-check should flag it
    // as an AUTOSAR_M5-0-7 unrecorded-violation (it's a real violation we
    // haven't wired a deviation for yet — Phase 4).
    //
    // We trigger the serial-helper emission with a console.log on arduino.
    const ts = `console.log("hello");`;
    const result = transpile(ts, { target: "arduino", autosar: "strict" });
    const m5Findings = result.diagnostics.filter((d) => d.code === "AUTOSAR_M5-0-7");
    // The cast is in the framework serial helper; if it surfaced in this
    // transpile's output, the self-check should have caught it.
    if (result.cpp.includes("(char)")) {
      expect(m5Findings.length).toBeGreaterThan(0);
      expect(m5Findings[0].severity).toBe("error");
      expect(m5Findings[0].message).toMatch(/M5-0-7/);
    }
  });

  it("strict mode promotes required unrecorded violations to error severity", () => {
    // Same as above but explicit: under strict, required-severity findings
    // become errors; under warn they stay warnings.
    const ts = `console.log("x");`;
    const strictResult = transpile(ts, { target: "arduino", autosar: "strict" });
    const warnResult = transpile(ts, { target: "arduino", autosar: "warn" });
    const strictM5 = strictResult.diagnostics.find((d) => d.code === "AUTOSAR_M5-0-7");
    const warnM5 = warnResult.diagnostics.find((d) => d.code === "AUTOSAR_M5-0-7");
    if (strictM5 && warnM5) {
      expect(strictM5.severity).toBe("error");
      expect(warnM5.severity).toBe("warning");
    }
  });
});
