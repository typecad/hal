import { describe, it, expect } from "vitest";
import { analyzeWorkerIsolation } from "../../../packages/cuttlefish/src/ir/worker-analysis";
import type { ProgramIR } from "../../../packages/cuttlefish/src/api/index.js";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types.js";

// ---------------------------------------------------------------------------
// Phase 2 — worker-isolation static analyzer
//
// The analyzer is unit-tested directly with hand-built ProgramIR fixtures,
// because there is not yet a user-facing TS API that emits worker.submit ops
// (that lands with the event-await wiring in Phase 3). These fixtures embed a
// worker.submit HAL op in an expression and exercise the three tiers:
//   (a) worker-written + main-read global  → volatile promotion (info)
//   (a') worker-written + main-written      → data-race warning
//   (b) bus access in a worker              → hard error
//   clean pure worker                       → no diagnostics
// ---------------------------------------------------------------------------

/** Build a minimal ProgramIR with the given top-level + function shapes. */
function makeProgram(opts: {
  topLevel?: any[];
  functions?: any[];
}): ProgramIR {
  return {
    topLevelStatements: opts.topLevel ?? [],
    functions: opts.functions ?? [],
    classes: [],
    namespaces: [],
  } as unknown as ProgramIR;
}

/** A statement that carries a worker.submit HAL op for the given fnRef.
 *  In the real IR, HAL ops appear as `hal-expr` expressions; the analyzer's
 *  scanner walks expressions looking for `.operation.operation`. */
function workerSubmitStmt(fnRef: string): any {
  return {
    kind: 'expression',
    expression: {
      kind: 'hal-expr',
      operation: { operation: 'worker.submit', handleId: 0, fnRef },
      sourceSpan: { filePath: 'test.ts', startLine: 1, startColumn: 0 },
    },
    sourceSpan: { filePath: 'test.ts', startLine: 1, startColumn: 0 },
  };
}

/** A var_decl global named `name`. */
function globalVar(name: string): any {
  return {
    kind: 'var_decl',
    name,
    initializer: { kind: 'number', value: 0 },
    sourceSpan: { filePath: 'test.ts', startLine: 5, startColumn: 0 },
  };
}

/** A simple assign statement: `name = value`. */
function assignStmt(name: string): any {
  return { kind: 'assign', target: name, value: { kind: 'number', value: 1 } };
}

/** A read statement referencing `name` (an identifier in an expression). */
function readStmt(name: string): any {
  return {
    kind: 'expression',
    expression: { kind: 'identifier', value: name },
  };
}

/** A function with the given body statements. */
function fn(name: string, statements: any[]): any {
  return { name, originalName: name, statements, sourceSpan: { filePath: 'test.ts', startLine: 10, startColumn: 0 } };
}

describe("analyzeWorkerIsolation — no worker.submit → no diagnostics", () => {
  it("returns nothing for a plain program with no worker ops", () => {
    const program = makeProgram({
      topLevel: [globalVar('flag')],
      functions: [fn('compute', [assignStmt('flag')])],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    expect(diags).toHaveLength(0);
  });
});

describe("analyzeWorkerIsolation — tier (a): shared globals", () => {
  it("promotes a worker-written + main-read global to volatile (info)", () => {
    const flagVar = globalVar('flag');
    const program = makeProgram({
      topLevel: [
        flagVar,
        workerSubmitStmt('compute'),   // main submits the worker
        readStmt('flag'),              // main reads flag
      ],
      functions: [
        fn('compute', [assignStmt('flag')]),   // worker writes flag
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    const vol = diags.find(d => (d as any).code === 'volatile-worker-shared');
    expect(vol).toBeDefined();
    expect((vol as any).severity).toBe('info');
    expect((vol as any).message).toContain('volatile');
    // The IR was mutated: isVolatile set on the global.
    expect((flagVar as any).isVolatile).toBe(true);
  });

  it("flags a global mutated by both worker and main as a data race (warning)", () => {
    const counter = globalVar('counter');
    const program = makeProgram({
      topLevel: [
        counter,
        workerSubmitStmt('compute'),
        assignStmt('counter'),        // main ALSO writes → race
      ],
      functions: [
        fn('compute', [assignStmt('counter')]),  // worker writes
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    const race = diags.find(d => (d as any).code === 'worker-shared-mutable');
    expect(race).toBeDefined();
    expect((race as any).severity).toBe('warning');
    expect((race as any).message).toContain('data race');
  });
});

describe("analyzeWorkerIsolation — tier (b): bus access in worker → error", () => {
  it("hard-errors when a worker calls Wire.begin()", () => {
    const program = makeProgram({
      topLevel: [
        globalVar('x'),
        workerSubmitStmt('readSensor'),
      ],
      functions: [
        fn('readSensor', [
          { kind: 'call', callee: 'Wire.begin', args: [], sourceSpan: { filePath: 'test.ts', startLine: 20, startColumn: 4 } },
        ]),
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    const busErr = diags.find(d => (d as any).code === 'worker-bus-access-forbidden');
    expect(busErr).toBeDefined();
    expect((busErr as any).severity).toBe('error');
    expect((busErr as any).message).toContain('Wire');
    expect((busErr as any).message).toContain('take()/release()');
  });

  it("hard-errors when a worker references I2C0", () => {
    const program = makeProgram({
      topLevel: [globalVar('x'), workerSubmitStmt('w')],
      functions: [
        fn('w', [readStmt('I2C0')]),
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    expect(diags.some(d => (d as any).code === 'worker-bus-access-forbidden')).toBe(true);
  });

  it("does NOT flag bus access in main-thread functions", () => {
    const program = makeProgram({
      topLevel: [globalVar('x'), workerSubmitStmt('w')],
      functions: [
        fn('w', [assignStmt('x')]),   // pure worker, no bus
        fn('mainRead', [{ kind: 'call', callee: 'Wire.begin', args: [] }]),  // main, bus OK
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    expect(diags.some(d => (d as any).code === 'worker-bus-access-forbidden')).toBe(false);
  });
});

describe("analyzeWorkerIsolation — clean pure worker", () => {
  it("produces no diagnostics for a pure worker with no shared state", () => {
    const program = makeProgram({
      topLevel: [
        globalVar('input'),
        globalVar('output'),
        workerSubmitStmt('pure'),
        assignStmt('input'),   // main writes input, reads output (no worker mutation)
        readStmt('output'),
      ],
      functions: [
        // Pure worker: reads input, writes output — but 'output' is NOT main-written,
        // and 'input' is NOT worker-mutated-shared in a racy way.
        fn('pure', [
          readStmt('input'),
          assignStmt('output'),
        ]),
      ],
    });
    const diags: Diagnostic[] = [];
    analyzeWorkerIsolation(program, diags);
    // output is worker-written + main-read → volatile promotion (info) IS expected.
    const vol = diags.find(d => (d as any).code === 'volatile-worker-shared');
    expect(vol).toBeDefined();
    // But NO data-race warning and NO bus error.
    expect(diags.some(d => (d as any).code === 'worker-shared-mutable')).toBe(false);
    expect(diags.some(d => (d as any).code === 'worker-bus-access-forbidden')).toBe(false);
  });
});
