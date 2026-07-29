import { describe, it, expect } from "vitest";
import { checkDynamicAllocation } from "../../../packages/safety/src/iso26262/heap-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[]): ProgramIR {
  return { fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [], classes: [], interfaces: [], namespaces: [], typeAliases: [], registerClasses: [], topLevelStatements: [], functions, boilerplates: new Set(), diagnostics: [] } as unknown as ProgramIR;
}

describe("B2: Dynamic allocation checker", () => {
  it("allows allocation in setup()", () => {
    const program = makeProgram([
      { originalName: "setup", statements: [{ kind: "raw", value: 'new Widget(5)' }] },
    ]);
    expect(checkDynamicAllocation(program, ctx)).toEqual([]);
  });

  it("flags new in loop()", () => {
    const program = makeProgram([
      { originalName: "loop", statements: [{ kind: "raw", value: 'new Widget(5)' }] },
    ]);
    const diags = checkDynamicAllocation(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("ISO26262_B2_DYNAMIC_ALLOC");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("loop");
  });

  it("flags malloc in a user function", () => {
    const program = makeProgram([
      { originalName: "process", statements: [{ kind: "raw", value: 'malloc(64)' }] },
    ]);
    const diags = checkDynamicAllocation(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("malloc");
  });

  it("returns no diagnostics for clean code", () => {
    const program = makeProgram([
      { originalName: "loop", statements: [{ kind: "call", callee: "digitalRead", args: [] }] },
    ]);
    expect(checkDynamicAllocation(program, ctx)).toEqual([]);
  });
});
