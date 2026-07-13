// ---------------------------------------------------------------------------
// Tests for the memory-budget and timing validators (C4 + C3).
//
// C4: Memory budget — compares the transpiler's static memory estimate against
//     the board's SRAM budget. Surfaces a warning when estimated usage exceeds
//     80% of SRAM, preventing the silent stack/heap collision that corrupts
//     memory on small-RAM targets.
//
// C3: Blocking delay in loop — flags delay() calls inside loop() that freeze
//     the async microtask queue and UI rendering. The transpiler knows what
//     loop() semantically is; g++ does not.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { validateMemoryBudget } from "../../../packages/cuttlefish/src/ir/memory-budget-validation";

const AVR_CTX = { platformContext: { architecture: "avr", frameworkData: { buildTarget: "arduino:avr:uno" } } };
const span = { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0, start: 0, end: 0 };

// ===========================================================================
// C4: Memory budget validation
// ===========================================================================

describe("Memory budget validation (C4)", () => {
  // Unit-level test (the integration path has an unsized-array estimator gap
  // in analyzeHeapUsage that's separate from this validator; tested here with
  // well-typed globals the estimator handles correctly).
  function mkProgram(n: number, sram: number) {
    return {
      topLevelStatements: Array.from({ length: n }, (_, i) => ({
        kind: "var_decl" as const, name: `g${i}`, cppType: "int", storage: "const" as const, sourceSpan: span,
      })),
      functions: [
        { name: "setup", originalName: "setup", statements: [] as any[], parameters: [], sourceSpan: span, isAsync: false, returnType: "void" },
        { name: "loop", originalName: "loop", statements: [] as any[], parameters: [], sourceSpan: span, isAsync: false, returnType: "void" },
      ],
      classes: [], typeAliases: [], structs: [], enums: [],
      imports: [], reExports: [], registerClasses: [],
      boilerplates: [], diagnostics: [], peripheralUsage: {},
      interfaces: [], namespaces: [], registeredCallbacks: [], restParamFunctions: new Map(),
      requiredIncludes: new Set(),
      boardConstants: new Map([["memory.sram", sram], ["architecture", "avr"]]),
    };
  }

  it("does NOT warn when usage is under 80% of SRAM", () => {
    // 500 ints × 2 bytes = 1000 bytes = ~49% of 2048.
    const p: any = mkProgram(500, 2048);
    const diags = validateMemoryBudget(p, p.boardConstants);
    expect(diags).toHaveLength(0);
  });

  it("warns when usage exceeds 80% of SRAM", () => {
    // 900 ints × 2 bytes = 1800 bytes = ~88% of 2048.
    const p: any = mkProgram(900, 2048);
    const diags = validateMemoryBudget(p, p.boardConstants);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("warning");
    expect((diags[0] as any).message).toMatch(/\d+%/);
    expect((diags[0] as any).message).toContain("SRAM");
  });

  it("errors when usage exceeds 100% of SRAM", () => {
    // 1200 ints × 2 bytes = 2400 bytes > 2048.
    const p: any = mkProgram(1200, 2048);
    const diags = validateMemoryBudget(p, p.boardConstants);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("error");
  });

  it("does NOT warn on ESP32 (larger SRAM budget)", () => {
    // ESP32 has ~320 KB SRAM. 900 ints × 4 bytes = 3600 bytes — tiny fraction.
    const p: any = mkProgram(900, 320 * 1024);
    const diags = validateMemoryBudget(p, p.boardConstants);
    expect(diags).toHaveLength(0);
  });

  it("returns no diagnostics when board constants are absent", () => {
    const p: any = mkProgram(900, 2048);
    p.boardConstants = undefined;
    const diags = validateMemoryBudget(p, undefined);
    expect(diags).toHaveLength(0);
  });

  // Integration: unsized-array estimator fix. Before the fix, large unsized
  // global arrays (the most common SRAM consumer on AVR) were silently
  // under-counted because estimateTypeSize returned 0 for cArray/vector types
  // with no size in the type string.
  it("integration: large unsized global array triggers memory-budget warning", () => {
    const r = transpile(
      `import { D13 } from '@typecad/board-arduino-uno';
       const buf: int32_t[] = [${Array(900).fill(0).join(",")}];
       function setup(): void { D13.asOutput(); console.log(buf[0]); }
       function loop(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    const memDiags = r.diagnostics.filter(d => (d as any).code === "memory-budget");
    expect(memDiags.length).toBeGreaterThanOrEqual(1);
    expect((memDiags[0] as any).message).toMatch(/\d+%/);
  });

  it("integration: small unsized global array does NOT trigger", () => {
    const r = transpile(
      `import { D13 } from '@typecad/board-arduino-uno';
       const buf: int32_t[] = [0, 0, 0];
       function setup(): void { D13.asOutput(); console.log(buf[0]); }
       function loop(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    const memDiags = r.diagnostics.filter(d => (d as any).code === "memory-budget");
    expect(memDiags).toHaveLength(0);
  });
});

// ===========================================================================
// C3: Blocking delay-in-loop detection
// ===========================================================================

describe("Blocking delay-in-loop detection (C3)", () => {
  it("flags delay() directly in loop()", () => {
    const r = transpile(
      `function setup(): void {}
       function loop(): void { delay(1000); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("warning");
    expect((diags[0] as any).message).toContain("loop()");
  });

  it("flags delay() nested inside an if in loop()", () => {
    const r = transpile(
      `function setup(): void {}
       function loop(): void { if (true) { delay(500); } }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags.length).toBeGreaterThanOrEqual(1);
  });

  it("flags delayMicroseconds() in loop()", () => {
    const r = transpile(
      `function setup(): void {}
       function loop(): void { delayMicroseconds(2000); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag delay() in setup()", () => {
    const r = transpile(
      `function setup(): void { delay(2000); }
       function loop(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags).toHaveLength(0);
  });

  it("does NOT flag delay() in a regular (non-loop) function", () => {
    const r = transpile(
      `function wait(): void { delay(300); }
       function setup(): void {}
       function loop(): void { wait(); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags).toHaveLength(0);
  });

  it("does NOT flag a program with no loop()", () => {
    const r = transpile(
      `function setup(): void { delay(1000); }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "blocking-delay-in-loop");
    expect(diags).toHaveLength(0);
  });
});
