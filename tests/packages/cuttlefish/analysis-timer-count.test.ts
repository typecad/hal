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
