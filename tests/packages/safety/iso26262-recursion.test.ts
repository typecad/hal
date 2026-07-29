import { describe, it, expect } from "vitest";
import { checkRecursion } from "../../../packages/safety/src/iso26262/recursion-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: Array<{ originalName: string; mappedName?: string; statements: any[] }>): ProgramIR {
  return {
    fileName: "test.ts",
    imports: [],
    reExports: [],
    structs: [],
    enums: [],
    classes: [],
    interfaces: [],
    namespaces: [],
    typeAliases: [],
    registerClasses: [],
    topLevelStatements: [],
    functions: functions as any,
    boilerplates: new Set<string>(),
    diagnostics: [],
  } as unknown as ProgramIR;
}

describe("B1: Recursion checker", () => {
  it("returns no diagnostics for non-recursive code", () => {
    const program = makeProgram([
      { originalName: "add", statements: [{ kind: "return", value: { kind: "binary", op: "+", left: { kind: "identifier", value: "a" }, right: { kind: "identifier", value: "b" } } }] },
      { originalName: "main", statements: [{ kind: "call", callee: "add", args: [] }] },
    ]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toEqual([]);
  });

  it("detects direct self-recursion", () => {
    const program = makeProgram([
      { originalName: "fib", statements: [
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
    expect(diags[0].message).toContain("fib");
  });

  it("detects mutual recursion (A calls B, B calls A)", () => {
    const program = makeProgram([
      { originalName: "funcA", statements: [{ kind: "call", callee: "funcB", args: [] }] },
      { originalName: "funcB", statements: [{ kind: "call", callee: "funcA", args: [] }] },
    ]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("ISO26262_B1_RECURSION");
    expect(diags[0].message).toMatch(/funcA.*funcB|funcB.*funcA/);
  });

  it("returns no diagnostics for a program with no functions", () => {
    const program = makeProgram([]);
    const diags = checkRecursion(program, ctx);
    expect(diags).toEqual([]);
  });

  it("detects recursion in class methods", () => {
    const program = makeProgram([]);
    (program as any).classes = [{
      name: "Counter",
      fields: [],
      methods: [{
        name: "increment",
        isStatic: false,
        statements: [{ kind: "call", callee: "increment", args: [] }],
      }],
      getters: [],
      setters: [],
    }];
    const diags = checkRecursion(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("increment");
  });
});
