// ---------------------------------------------------------------------------
// Tests for the ISR safety group.
//
// Three capabilities that exploit the transpiler's unique knowledge of which
// callbacks are interrupt handlers:
//   1. Prerequisite: ISR-unsafe-op detection now fires for user lambdas
//      (onRising/onFalling), not just HAL-author callback() directives.
//   2. C1: Automatic `volatile` inference for globals shared between ISR and
//      main code (eliminates the classic register-caching infinite-loop bug).
//   3. C2: Reentrancy detection for functions called from both ISR and main.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

const AVR_CTX = { platformContext: { architecture: "avr", frameworkData: { buildTarget: "arduino:avr:uno" } } };

// ===========================================================================
// Prerequisite: ISR-unsafe-op detection for user lambdas
// ===========================================================================

describe("ISR-unsafe-op detection (prerequisite fix)", () => {
  it("flags delay() inside an onFalling() callback", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function setup(): void {
         D2.asInput().onFalling(() => { delay(100); });
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "interrupt-unsafe-operation");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).message).toContain("delay");
  });

  it("flags delay() inside an onRising() callback", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function setup(): void {
         D2.asInput().onRising(() => { delay(50); });
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "interrupt-unsafe-operation");
    expect(diags.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag delay() outside an ISR", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function setup(): void {
         D2.asInput();
         delay(100);
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "interrupt-unsafe-operation");
    expect(diags).toHaveLength(0);
  });
});

// ===========================================================================
// C1: Automatic volatile inference
// ===========================================================================

describe("Automatic volatile inference (C1)", () => {
  it("marks a global volatile when written in ISR and read in loop", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       let flag = false;
       function setup(): void {
         D2.asInput().onFalling(() => { flag = true; });
       }
       function loop(): void {
         if (flag) { console.log("triggered"); flag = false; }
       }`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp.toLowerCase()).toMatch(/volatile\s+(bool|int)\s+flag/);
    const diags = r.diagnostics.filter(d => (d as any).code === "volatile-isr-shared");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("info");
  });

  it("marks a counter incremented in ISR and read in loop", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       let ticks = 0;
       function setup(): void {
         D2.asInput().onRising(() => { ticks++; });
       }
       function loop(): void { console.log(ticks); }`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp.toLowerCase()).toMatch(/volatile\s+.*ticks/);
  });

  it("does NOT mark a global volatile when not shared with an ISR", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       let counter = 0;
       function setup(): void {
         D2.asInput().onFalling(() => { });
         counter = 1;
       }
       function loop(): void { console.log(counter); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const declLine = r.cpp.split("\n").find(l =>
      l.includes("counter") && l.includes("=") && !l.includes("//") && !l.includes("Serial"));
    expect(declLine!.toLowerCase()).not.toMatch(/volatile\s+.*counter/);
  });

  it("does NOT mark a global volatile when only read in ISR (not written)", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       let threshold = 500;
       function setup(): void {
         D2.asInput().onFalling(() => { if (threshold > 0) console.log("ok"); });
       }
       function loop(): void { console.log(threshold); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const volDiags = r.diagnostics.filter(d => (d as any).code === "volatile-isr-shared");
    // threshold is READ in the ISR but not WRITTEN, so no volatile needed.
    expect(volDiags).toHaveLength(0);
  });
});

// ===========================================================================
// C2: Reentrancy detection
// ===========================================================================

describe("Reentrancy detection (C2)", () => {
  it("flags a user function called from both ISR and loop", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function process(): void { console.log("processing"); }
       function setup(): void {
         D2.asInput().onFalling(() => { process(); });
       }
       function loop(): void { process(); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "reentrancy-risk");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("warning");
    expect((diags[0] as any).message).toContain("process");
  });

  it("does NOT flag a function called only from main code", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function process(): void { console.log("processing"); }
       function setup(): void {
         D2.asInput().onFalling(() => { console.log("isr"); });
       }
       function loop(): void { process(); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "reentrancy-risk");
    expect(diags).toHaveLength(0);
  });

  it("does NOT flag a function called only from ISR code", () => {
    const r = transpile(
      `import { D2 } from '@typecad/board-arduino-uno';
       function handleIsr(): void { console.log("isr-only"); }
       function setup(): void {
         D2.asInput().onFalling(() => { handleIsr(); });
       }
       function loop(): void { console.log("main"); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "reentrancy-risk");
    expect(diags).toHaveLength(0);
  });
});
