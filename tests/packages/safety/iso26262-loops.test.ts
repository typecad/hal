import { describe, it, expect } from "vitest";
import { checkUnboundedLoops } from "../../../packages/safety/src/iso26262/loop-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[]): ProgramIR {
  return { fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [], classes: [], interfaces: [], namespaces: [], typeAliases: [], registerClasses: [], topLevelStatements: [], functions, boilerplates: new Set(), diagnostics: [] } as unknown as ProgramIR;
}

describe("B3: Unbounded loop checker", () => {
  it("flags while(true)", () => {
    const program = makeProgram([
      { originalName: "loop", statements: [
        { kind: "while", condition: { kind: "boolean", value: true }, body: [{ kind: "call", callee: "delay", args: [] }] },
      ]},
    ]);
    const diags = checkUnboundedLoops(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("ISO26262_B3_UNBOUNDED_LOOP");
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("while(true)");
  });

  it("flags for(;;) (empty condition)", () => {
    const program = makeProgram([
      { originalName: "run", statements: [
        { kind: "for", initializer: null, condition: null, increment: null, body: [{ kind: "call", callee: "tick", args: [] }] },
      ]},
    ]);
    const diags = checkUnboundedLoops(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("for(;;)");
  });

  it("allows bounded for loop", () => {
    const program = makeProgram([
      { originalName: "loop", statements: [
        { kind: "for", initializer: { kind: "var_decl", name: "i", cppType: "int" }, condition: { kind: "binary", op: "<", left: { kind: "identifier", value: "i" }, right: { kind: "number", value: 10 } }, increment: { kind: "update", op: "++", target: "i" }, body: [] },
      ]},
    ]);
    expect(checkUnboundedLoops(program, ctx)).toEqual([]);
  });

  it("allows while(condition) with non-constant condition", () => {
    const program = makeProgram([
      { originalName: "wait", statements: [
        { kind: "while", condition: { kind: "call", callee: "sensorReady", args: [] }, body: [] },
      ]},
    ]);
    expect(checkUnboundedLoops(program, ctx)).toEqual([]);
  });
});
