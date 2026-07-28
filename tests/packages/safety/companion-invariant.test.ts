import { describe, it, expect } from "vitest";
import { pinModeInterceptPass } from "../../../packages/safety/src/passes/pinMode-intercept";
import type { ProgramIR, StatementIR } from "../../../packages/cuttlefish/src/api/shared";

const halOp = (operation: string, extra: Record<string, unknown> = {}): StatementIR =>
  ({
    kind: "hal-op",
    operation: { operation, ...extra },
    sourceSpan: { startLine: 1, startColumn: 1, filePath: "t.ts" },
    returns_value: false,
  }) as unknown as StatementIR;

describe("companion invariant (v2 — gpio.set_mode)", () => {
  it("every gpio.set_mode has an immediate record_pin_mode successor", () => {
    const statements: StatementIR[] = [
      halOp("gpio.set_mode", { pin: 1, mode: "INPUT" }),
      halOp("gpio.write", { pin: 2, value: 1 }),
      halOp("gpio.set_mode", { pin: 3, mode: "OUTPUT" }),
      halOp("gpio.read", { pin: 4 }),
    ];
    const prog: ProgramIR = {
      fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
      classes: [], typeAliases: [], topLevelStatements: statements, functions: [],
      boilerplates: [], diagnostics: [], registerClasses: [], boardConstants: undefined,
      interfaces: [], namespaces: [], peripheralUsage: {}, requiredIncludes: [],
    } as unknown as ProgramIR;
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });

    for (let i = 0; i < out.topLevelStatements.length; i++) {
      const s = out.topLevelStatements[i]!;
      if (s.kind !== "hal-op") continue;
      const opName = (s as any).operation.operation as string;
      if (opName === "gpio.set_mode") {
        const next = out.topLevelStatements[i + 1];
        expect(next).toBeDefined();
        expect((next as any)?.operation?.operation).toBe("safety.record_pin_mode");
      }
    }
  });
});
