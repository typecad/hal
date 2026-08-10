import { describe, it, expect } from "vitest";
import { analyzeProgram } from "../../../packages/cuttlefish/src/ir/program-analysis";
import { GenericStrategy } from "../../../packages/cuttlefish/src/platform/generic-strategy";
import type { ProgramIR } from "../../../packages/cuttlefish/src/api/index.js";

// Regression for the top-level setInterval bug: a top-level `setInterval(...)`
// call stays a `call` STATEMENT (the arrow-callback hoister rewrites it to
// __tc_setInterval), never becoming a method-call expression. The analyzer's
// statement-form path must count it, or timerCallCount stays 0 and the timer
// polyfill gate fails → "__tc_setInterval was not declared in this scope".

// GenericStrategy implements the full PlatformStrategy surface the analyzer
// reads (needsStdVector, isConsoleCall, mapReturnType, …) without framework deps.
const stubStrategy = new GenericStrategy();

function makeProgram(topLevel: any[], functions: any[] = []): ProgramIR {
  return {
    topLevelStatements: topLevel,
    functions,
    classes: [],
    namespaces: [],
    typeAliases: [],
    interfaces: [],
  } as unknown as ProgramIR;
}

describe("analyzeProgram — timer call counting (statement-form regression)", () => {
  it("counts a top-level setInterval call (statement form, post-rename callee)", () => {
    // After the arrow-callback hoister, top-level setInterval(fn, ms) becomes a
    // call statement with callee __tc_setInterval. This is the exact shape that
    // was missed (timerCallCount stayed 0 → polyfill not emitted).
    const prog = makeProgram([
      { kind: "call", callee: "__tc_setInterval", args: [] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
  });

  it("counts a top-level setInterval call (pre-rename callee 'setInterval')", () => {
    const prog = makeProgram([
      { kind: "call", callee: "setInterval", args: [] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
  });

  it("counts setTimeout / __tc_setTimeout too", () => {
    const prog = makeProgram([
      { kind: "call", callee: "setTimeout", args: [] },
      { kind: "call", callee: "__tc_setTimeout", args: [] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(2);
  });

  it("counts setInterval inside a function body (statement form)", () => {
    const prog = makeProgram([], [
      { isAsync: false, returnType: "void", parameters: [], statements: [{ kind: "call", callee: "__tc_setInterval", args: [] }] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
  });

  it("counts multiple timer call sites", () => {
    const prog = makeProgram([
      { kind: "call", callee: "__tc_setInterval", args: [] },
      { kind: "call", callee: "__tc_setInterval", args: [] },
      { kind: "call", callee: "__tc_setTimeout", args: [] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(3);
  });

  it("leaves timerCallCount at 0 when no timers are used", () => {
    const prog = makeProgram([
      { kind: "call", callee: "delay", args: [] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(0);
  });
});

// Regression for the Timing.setInterval bug: `Timing.setInterval(...)` is
// resolved by the HAL method resolver, which reads TimingClass's rawCpp body
// and emits a raw hal-op (or an __EMIT__ statement) whose payload is
// `__tc_setInterval(...)`. The callee-based counter above only fires for bare
// timer calls, so without raw-payload scanning the timer_methods polyfill gate
// (timerCallCount == 0) drops the polyfill and the link fails:
// "'__tc_setInterval' was not declared in this scope". These mirror the exact
// lowering shapes produced for `Timing.setInterval(cb, ms)`.

describe("analyzeProgram — Timing.setInterval raw-payload counting (regression)", () => {
  it("counts a __tc_setInterval call inside a raw hal-op (statement form)", () => {
    // `Timing.setInterval(cb, 500)` lowers to a hal-op with operation "raw"
    // whose code is the rawCpp payload (`return __tc_setInterval(cb, 500)`).
    const prog = makeProgram([
      { kind: "hal-op", returns_value: false, operation: { operation: "raw", code: "return __tc_setInterval(main_isr_0, 500);" } },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
    expect(result.usedPolyfillHelpers.has("__tc_setInterval")).toBe(true);
  });

  it("counts a __tc_setTimeout call inside a raw hal-op (statement form)", () => {
    const prog = makeProgram([
      { kind: "hal-op", returns_value: false, operation: { operation: "raw", code: "__tc_setTimeout(cb, 1000);" } },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
    expect(result.usedPolyfillHelpers.has("__tc_setTimeout")).toBe(true);
  });

  it("counts __tc_setInterval embedded in an __EMIT__ statement's string arg", () => {
    // The alternate lowering path: Timing.setInterval → __EMIT__ call statement
    // whose single string arg carries the raw C++ payload.
    const prog = makeProgram([
      { kind: "call", callee: "__EMIT__", args: [{ kind: "string", value: "__tc_setInterval(main_isr_0, 500);" }] },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
    expect(result.usedPolyfillHelpers.has("__tc_setInterval")).toBe(true);
  });

  it("counts Timing.setInterval in expression position (raw expr, e.g. const id = Timing.setInterval(...))", () => {
    const prog = makeProgram([
      {
        kind: "var_decl",
        cppType: "int32_t",
        name: "id",
        initializer: { kind: "raw", value: "__tc_setInterval(main_isr_0, 500)" },
      },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(1);
    expect(result.usedPolyfillHelpers.has("__tc_setInterval")).toBe(true);
  });

  it("counts multiple timer call sites inside one raw hal-op payload", () => {
    const prog = makeProgram([
      { kind: "hal-op", returns_value: false, operation: { operation: "raw", code: "__tc_setInterval(a, 100); __tc_setInterval(b, 200); __tc_setTimeout(c, 300);" } },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(3);
  });

  it("does not count timer-like substrings that are not calls (e.g. declarations)", () => {
    // A definition line `int32_t __tc_setInterval(...)` contains the name but
    // should still be counted as a call site by the substring scan — this is
    // the conservative behavior shared with the bare-call path (the counter is
    // a sizing hint, not a precise call graph). Here we just assert the scan
    // matches the `(` form, so a bare name without parens is NOT counted.
    const prog = makeProgram([
      { kind: "hal-op", returns_value: false, operation: { operation: "raw", code: "// references __tc_setInterval without a call" } },
    ]);
    const result = analyzeProgram(prog, stubStrategy);
    expect(result.timerCallCount).toBe(0);
  });
});
