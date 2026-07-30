import { describe, it, expect } from "vitest";
import { collectSafetyMetadata } from "../../../packages/safety/src/iso26262/collect";
import { renderSafetySidecar } from "../../../packages/safety/src/iso26262/sidecar-writer";
import type { ProgramIR } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

const ctx: SafetyTransformContext = { safetyInUse: true, target: "arduino" };

function makeProgram(functions: any[]): ProgramIR {
  return { fileName: "test.ts", imports: [], reExports: [], structs: [], enums: [], classes: [], interfaces: [], namespaces: [], typeAliases: [], registerClasses: [], topLevelStatements: [], functions, boilerplates: new Set(), diagnostics: [] } as unknown as ProgramIR;
}

describe("Part C: Safety metadata collection + sidecar", () => {
  it("collects metadata for ASIL-annotated functions", () => {
    const program = makeProgram([
      { originalName: "setup", parameters: [], statements: [] },
      { originalName: "engageBrake", decorators: ["asilD"], parameters: [],
        sourceSpan: { filePath: "src/main.ts", startOffset: 0, endOffset: 1, startLine: 42, startColumn: 1, endLine: 42, endColumn: 1 },
        statements: [
          { kind: "hal-op", operation: "safety.write_verify" },
        ],
      },
      { originalName: "readSensor", decorators: ["asilC"], parameters: [],
        sourceSpan: { filePath: "src/main.ts", startOffset: 0, endOffset: 1, startLine: 57, startColumn: 1, endLine: 57, endColumn: 1 },
        statements: [
          { kind: "hal-op", operation: "safety.read_safe" },
        ],
      },
      { originalName: "logStatus", parameters: [], statements: [] },
    ]);
    const result = collectSafetyMetadata(program, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].functions).toHaveLength(2);
    const brake = result[0].functions[0];
    expect(brake.name).toBe("engageBrake");
    expect(brake.asilLevel).toBe("D");
    expect(brake.mechanisms).toContain("safe.write");
    expect(brake.source).toMatchObject({ tsFile: "src/main.ts", tsLine: 42 });
    const sensor = result[0].functions[1];
    expect(sensor.asilLevel).toBe("C");
    expect(sensor.mechanisms).toContain("safe.read");
  });

  it("skips QM (non-annotated) functions", () => {
    const program = makeProgram([
      { originalName: "logStatus", parameters: [], statements: [] },
    ]);
    const result = collectSafetyMetadata(program, ctx);
    expect(result[0].functions).toHaveLength(0);
  });

  it("detects SafeVariable and SafeInt mechanisms", () => {
    const program = makeProgram([
      { originalName: "compute", decorators: ["asilD"], parameters: [],
        sourceSpan: { filePath: "test.ts", startOffset: 0, endOffset: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        statements: [
          { kind: "var_decl", name: "counter", cppType: "SafeVariable<int32_t>" },
          { kind: "raw", value: "SafeInt<int32_t> temp(0)" },
        ],
      },
    ]);
    const result = collectSafetyMetadata(program, ctx);
    expect(result[0].functions).toHaveLength(1);
    const fn = result[0].functions[0];
    expect(fn.mechanisms).toContain("SafeVariable");
    expect(fn.mechanisms).toContain("SafeInt");
  });

  it("renders valid sidecar JSON", () => {
    const program = makeProgram([
      { originalName: "brake", decorators: ["asilD"], parameters: [],
        sourceSpan: { filePath: "src/main.ts", startOffset: 0, endOffset: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        statements: [{ kind: "hal-op", operation: "safety.write_verify" }],
      },
    ]);
    const metadata = collectSafetyMetadata(program, ctx);
    const json = JSON.parse(renderSafetySidecar(metadata[0], "1.0.0"));
    expect(json.schemaVersion).toBe("1.0.0");
    expect(json.standard).toBe("ISO 26262 Part 6");
    expect(json.tool).toContain("cuttlefish");
    expect(json.safetyFunctions).toHaveLength(1);
    expect(json.safetyFunctions[0].name).toBe("brake");
    expect(json.safetyFunctions[0].asilLevel).toBe("D");
    expect(json.safetyFunctions[0].mechanisms).toContain("safe.write");
    expect(json.safetyFunctions[0].rules.B1_RECURSION).toBe("pass");
  });

  it("records rule warnings in the sidecar", () => {
    const program = makeProgram([
      { originalName: "run", decorators: ["asilC"], parameters: [],
        sourceSpan: { filePath: "src/main.ts", startOffset: 0, endOffset: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        statements: [
          { kind: "while", condition: { kind: "boolean", value: true }, body: [] },
        ],
      },
    ]);
    const metadata = collectSafetyMetadata(program, ctx);
    const fn = metadata[0].functions[0];
    expect(fn.rules.B3_UNBOUNDED_LOOP).toMatchObject({
      severity: "warning",
      message: expect.stringContaining("while(true)"),
    });
    expect(fn.rules.B1_RECURSION).toBe("pass");
  });
});
