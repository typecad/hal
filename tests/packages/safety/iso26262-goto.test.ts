import { describe, it, expect } from "vitest";
import { checkGoto } from "../../../packages/safety/src/iso26262/goto-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[]): ProgramIR {
  return { fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [], classes: [], interfaces: [], namespaces: [], typeAliases: [], registerClasses: [], topLevelStatements: [], functions, boilerplates: new Set(), diagnostics: [] } as unknown as ProgramIR;
}

describe("B6: Goto checker (ASIL C+)", () => {
  it("does NOT check QM functions", () => {
    const program = makeProgram([
      { originalName: "loop", parameters: [], statements: [
        { kind: "raw", value: "goto __break_outer;" },
      ]},
    ]);
    expect(checkGoto(program, ctx)).toEqual([]);
  });

  it("flags goto in @asilC function", () => {
    const program = makeProgram([
      { originalName: "run", decorators: ["asilC"], parameters: [], statements: [
        { kind: "raw", value: "goto __break_outer;" },
      ]},
    ]);
    const diags = checkGoto(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("ISO26262_B6_GOTO");
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message).toContain("__break_outer");
  });

  it("flags goto in @asilD function", () => {
    const program = makeProgram([
      { originalName: "run", decorators: ["asilD"], parameters: [], statements: [
        { kind: "raw", value: "goto exit_loop;" },
      ]},
    ]);
    const diags = checkGoto(program, ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("exit_loop");
  });

  it("does NOT flag non-goto raw expressions", () => {
    const program = makeProgram([
      { originalName: "run", decorators: ["asilD"], parameters: [], statements: [
        { kind: "raw", value: "x + 1" },
      ]},
    ]);
    expect(checkGoto(program, ctx)).toEqual([]);
  });
});
