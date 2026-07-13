// ---------------------------------------------------------------------------
// Tests for the revived validators (Category A fix).
//
// These three validators were wired into the orchestrator but emitted nothing
// due to dead code paths (stubbed detectors, never-invoked helpers). The tests
// here confirm they now fire on the patterns they were designed to catch:
//   - validateADCRange: comparisons against values exceeding the ADC max
//   - validateUnitSuspicion: unit confusion (kHz vs Hz) in peripheral config
//   - validatePinModeConfig: GPIO reads/writes without prior mode config
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

const AVR_CTX = { platformContext: { architecture: "avr", frameworkData: { buildTarget: "arduino:avr:uno" } } };

describe("validateADCRange (revived)", () => {
  it("flags inline analogRead() > ADC max on 10-bit AVR", () => {
    const result = transpile(
      `import { A0 } from '@typecad/board-arduino-uno';
       function loop(): void {
         if (A0.asInput().readAnalog() > 2000) { console.log("high"); }
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = result.diagnostics.filter(d => (d as any).code === "adc-range-warning");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).message).toContain("10-bit");
    expect((diags[0] as any).message).toContain("1023");
  });

  it("does NOT flag analogRead() within the ADC range", () => {
    const result = transpile(
      `import { A0 } from '@typecad/board-arduino-uno';
       function loop(): void {
         if (A0.asInput().readAnalog() > 500) { console.log("high"); }
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = result.diagnostics.filter(d => (d as any).code === "adc-range-warning");
    expect(diags).toHaveLength(0);
  });
});

describe("validateUnitSuspicion (revived)", () => {
  it("flags I2C setClock(100) as a likely kHz-not-Hz mistake", () => {
    const result = transpile(
      `import { I2C0 } from '@typecad/board-arduino-uno';
       function setup(): void {
         I2C0.begin();
         I2C0.setClock(100);
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = result.diagnostics.filter(d => (d as any).code === "unit-suspicion");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).message).toContain("kHz");
    expect((diags[0] as any).message).toContain("100000");
  });

  it("does NOT flag I2C setClock(100000) (correct Hz)", () => {
    const result = transpile(
      `import { I2C0 } from '@typecad/board-arduino-uno';
       function setup(): void {
         I2C0.begin();
         I2C0.setClock(100000);
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = result.diagnostics.filter(d => (d as any).code === "unit-suspicion");
    expect(diags).toHaveLength(0);
  });
});

describe("validatePinModeConfig (revived)", () => {
  it("warns on a digital read without prior mode configuration", () => {
    const result = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function loop(): void {
         const v = D2.isHigh();
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = result.diagnostics.filter(
      d => (d as any).code === "pin-mode-not-set" && (d as any).severity === "warning",
    );
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).message).toContain("mode");
  });

  it("does NOT warn when asInput() is called before the read", () => {
    const result = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function setup(): void { D2.asInput(); }
       function loop(): void { const v = D2.isHigh(); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const readDiags = result.diagnostics.filter(
      d => (d as any).code === "pin-mode-not-set" && (d as any).severity === "warning",
    );
    expect(readDiags).toHaveLength(0);
  });
});
