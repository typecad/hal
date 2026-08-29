import { describe, it, expect } from "vitest";
import { checkInitCompleteness } from "../../../../packages/cuttlefish/src/safety/iso26262/init-checker";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[], topLevelStatements: any[] = []): ProgramIR {
  return { fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [], classes: [], interfaces: [], namespaces: [], typeAliases: [], registerClasses: [], topLevelStatements, functions, boilerplates: new Set(), diagnostics: [] } as unknown as ProgramIR;
}

describe("B5: Init completeness checker (ASIL D)", () => {
  it("does NOT check QM functions", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [] },
      { originalName: "run", parameters: [], statements: [{ kind: "assign", target: "x", value: { kind: "identifier", value: "mysteryVar" } }] },
    ]);
    expect(checkInitCompleteness(program, ctx)).toEqual([]);
  });

  it("does NOT check @asilC functions (init is ASIL D)", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [] },
      { originalName: "run", decorators: ["asilC"], parameters: [], statements: [{ kind: "assign", target: "x", value: { kind: "identifier", value: "mysteryVar" } }] },
    ]);
    expect(checkInitCompleteness(program, ctx)).toEqual([]);
  });

  it("flags uninitialized variable in @asilD function", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [] },
      { originalName: "run", decorators: ["asilD"], parameters: [], statements: [
        { kind: "assign", target: "x", value: { kind: "identifier", value: "uninitializedVar" } },
      ]},
    ]);
    const diags = checkInitCompleteness(program, ctx);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe("ISO26262_B5_INIT_COMPLETENESS");
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("uninitializedVar");
  });

  it("allows variables initialized in setup()", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [
        { kind: "var_decl", name: "myVar", cppType: "int" },
      ]},
      { originalName: "run", decorators: ["asilD"], parameters: [], statements: [
        { kind: "assign", target: "x", value: { kind: "identifier", value: "myVar" } },
      ]},
    ]);
    const diags = checkInitCompleteness(program, ctx);
    const myVarDiags = diags.filter(d => d.message.includes("myVar"));
    expect(myVarDiags).toEqual([]);
  });

  it("allows variables initialized at file scope", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [] },
      { originalName: "run", decorators: ["asilD"], parameters: [], statements: [
        { kind: "assign", target: "x", value: { kind: "identifier", value: "globalVar" } },
      ]},
    ], [
      { kind: "var_decl", name: "globalVar", cppType: "int" },
    ]);
    const diags = checkInitCompleteness(program, ctx);
    const globalVarDiags = diags.filter(d => d.message.includes("globalVar"));
    expect(globalVarDiags).toEqual([]);
  });
});
