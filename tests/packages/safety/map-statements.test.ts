import { describe, it, expect } from "vitest";
import { mapProgramStatements } from "../../../packages/cuttlefish/src/ir/utils/map-statements";
import type { ProgramIR, StatementIR } from "../../../packages/cuttlefish/src/api/shared";

// Minimal ProgramIR fixture — only the fields mapProgramStatements walks.
// Modeled on the fakeProgram() pattern in tests/packages/cuttlefish/network-validation.test.ts.
function makeProgram(statements: StatementIR[]): ProgramIR {
  return {
    fileName: "test.ts",
    imports: [],
    reExports: [],
    structs: [],
    enums: [],
    classes: [],
    typeAliases: [],
    topLevelStatements: statements,
    functions: [],
    boilerplates: [],
    diagnostics: [],
    registerClasses: [],
    boardConstants: undefined,
    interfaces: [],
    namespaces: [],
    peripheralUsage: {},
    requiredIncludes: [],
  } as unknown as ProgramIR;
}

// HAL-op statement helper — matches HALOpStatementIR (ir-core.ts:299-308).
const halOp = (operation: string, extra: Record<string, unknown> = {}): StatementIR =>
  ({
    kind: "hal-op",
    operation: { operation, ...extra },
    sourceSpan: { startLine: 1, startColumn: 1, filePath: "test.ts" },
    returns_value: false,
  }) as unknown as StatementIR;

describe("mapProgramStatements", () => {
  it("returns a program whose top-level statements are mapped by fn", () => {
    const original = makeProgram([
      halOp("gpio.write", { pin: 1, value: 1 }),
      halOp("gpio.write", { pin: 2, value: 0 }),
    ]);
    const result = mapProgramStatements(original, (s) => [s, halOp("gpio.read", { pin: 99 })]);
    expect(result.topLevelStatements.length).toBe(4);
    expect((result.topLevelStatements[1] as any).operation.operation).toBe("gpio.read");
    expect((result.topLevelStatements[3] as any).operation.operation).toBe("gpio.read");
  });

  it("does not mutate the input program", () => {
    const original = makeProgram([halOp("gpio.write", { pin: 1, value: 1 })]);
    mapProgramStatements(original, () => []);
    expect(original.topLevelStatements.length).toBe(1);
  });

  it("maps statements inside function bodies", () => {
    const fnStmt = halOp("gpio.write", { pin: 1, value: 1 });
    const original: ProgramIR = {
      ...makeProgram([]),
      functions: [{
        name: "f", originalName: "f", returnType: "void",
        parameters: [], statements: [fnStmt], sourceSpan: undefined as any,
      }],
    } as unknown as ProgramIR;
    const result = mapProgramStatements(original, (s) => [s, halOp("gpio.read", { pin: 7 })]);
    expect(result.functions[0]!.statements.length).toBe(2);
    expect((result.functions[0]!.statements[1] as any).operation.operation).toBe("gpio.read");
  });

  it("returns identity (same count) when fn wraps each stmt in a singleton array", () => {
    const original = makeProgram([halOp("gpio.write", { pin: 1, value: 1 })]);
    const result = mapProgramStatements(original, (s) => [s]);
    expect(result.topLevelStatements.length).toBe(1);
  });

  it("removes statements when fn returns []", () => {
    const original = makeProgram([
      halOp("gpio.write", { pin: 1, value: 1 }),
      halOp("gpio.write", { pin: 2, value: 0 }),
    ]);
    const result = mapProgramStatements(original, () => []);
    expect(result.topLevelStatements.length).toBe(0);
  });
});
