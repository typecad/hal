import { describe, it, expect } from "vitest";
import { checkRecursion } from "../../../../packages/cuttlefish/src/safety/iso26262/recursion-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[]): ProgramIR {
  return {
    fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [],
    classes: [], interfaces: [], namespaces: [], typeAliases: [],
    registerClasses: [], topLevelStatements: [], functions,
    boilerplates: new Set(), diagnostics: [],
  } as unknown as ProgramIR;
}

describe("B1: Recursion checker (ASIL-gated)", () => {
  it("does NOT check QM functions (no decorator)", () => {
    const program = makeProgram([
      { originalName: "fib", statements: [
        { kind: "if", condition: { kind: "number", value: 1 },
          thenBranch: [{ kind: "return", value: { kind: "number", value: 1 } }],
          elseBranch: [{ kind: "call", callee: "fib", args: [] }],
        },
      ]},
    ]);
    expect(checkRecursion(program, ctx)).toEqual([]);
  });

  it("checks @asilB functions for recursion", () => {
    const program = makeProgram([
      { originalName: "fib", decorators: ["asilB"], statements: [
        { kind: "if", condition: { kind: "number", value: 1 },
          thenBranch: [{ kind: "return", value: { kind: "number", value: 1 } }],
          elseBranch: [{ kind: "call", callee: "fib", args: [] }],
        },
      ]},
    ]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("ISO26262_B1_RECURSION");
    expect(diags[0].severity).toBe("error");
  });

  it("checks @asilD functions for recursion", () => {
    const program = makeProgram([
      { originalName: "factorial", decorators: ["asilD"], statements: [
        { kind: "call", callee: "factorial", args: [] },
      ]},
    ]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("factorial");
  });

  it("detects mutual recursion when one function is ASIL", () => {
    const program = makeProgram([
      { originalName: "funcA", decorators: ["asilC"], statements: [{ kind: "call", callee: "funcB", args: [] }] },
      { originalName: "funcB", statements: [{ kind: "call", callee: "funcA", args: [] }] },
    ]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/funcA.*funcB|funcB.*funcA/);
  });

  it("does NOT check @asilA functions", () => {
    const program = makeProgram([
      { originalName: "fib", decorators: ["asilA"], statements: [
        { kind: "call", callee: "fib", args: [] },
      ]},
    ]);
    expect(checkRecursion(program, ctx)).toEqual([]);
  });

  it("returns no diagnostics for non-recursive ASIL function", () => {
    const program = makeProgram([
      { originalName: "compute", decorators: ["asilD"], statements: [
        { kind: "return", value: { kind: "number", value: 42 } },
      ]},
    ]);
    expect(checkRecursion(program, ctx)).toEqual([]);
  });

  it("returns no diagnostics for empty program", () => {
    expect(checkRecursion(makeProgram([]), ctx)).toEqual([]);
  });
});
