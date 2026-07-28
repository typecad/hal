import { describe, it, expect } from "vitest";
import { pinModeInterceptPass } from "../../../packages/safety/src/passes/pinMode-intercept";
import type { ProgramIR, StatementIR } from "../../../packages/cuttlefish/src/api/shared";

function programWith(stmts: StatementIR[]): ProgramIR {
  return {
    fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
    classes: [], typeAliases: [], topLevelStatements: stmts, functions: [],
    boilerplates: [], diagnostics: [], registerClasses: [], boardConstants: undefined,
    interfaces: [], namespaces: [], peripheralUsage: {}, requiredIncludes: [],
  } as unknown as ProgramIR;
}

const halOp = (operation: string, extra: Record<string, unknown> = {}): StatementIR =>
  ({
    kind: "hal-op",
    operation: { operation, ...extra },
    sourceSpan: { startLine: 1, startColumn: 1, filePath: "t.ts" },
    returns_value: false,
  }) as unknown as StatementIR;

describe("pinModeInterceptPass", () => {
  it("injects a record_pin_mode companion after gpio.pin_mode", () => {
    const prog = programWith([
      halOp("gpio.pin_mode", { pin: 5, mode: 0 }),
    ]);
    const ctx = { safetyInUse: true, target: "esp32" };
    const out = pinModeInterceptPass(prog, ctx);
    expect(out.topLevelStatements.length).toBe(2);
    expect((out.topLevelStatements[1] as any).operation.operation).toBe("safety.record_pin_mode");
    expect((out.topLevelStatements[1] as any).operation.pin).toBe(5);
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(0);
  });

  it("injects a companion after safety.pin_mode too", () => {
    const prog = programWith([
      halOp("safety.pin_mode", { pin: 7, mode: 1 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.operation).toBe("safety.record_pin_mode");
  });

  it("leaves non-pin-mode hal-ops untouched", () => {
    const prog = programWith([
      halOp("gpio.write", { pin: 5, value: 1 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(1);
  });
});
