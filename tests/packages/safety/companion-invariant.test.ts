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

  it("injects companions for gpio.set_mode inside function bodies too", () => {
    // The companion invariant must hold inside functions[].statements as well
    // as at top level — mapProgramStatements walks both. A Pin.asInput() call
    // inside a user function should get a record_pin_mode companion.
    const fnBody: StatementIR[] = [
      halOp("gpio.set_mode", { pin: 7, mode: "INPUT" }),
      halOp("gpio.read", { pin: 7 }),
    ];
    const prog: ProgramIR = {
      fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
      classes: [], typeAliases: [], topLevelStatements: [], functions: [
        { name: "configurePin", params: [], statements: fnBody,
          sourceSpan: { startLine: 1, startColumn: 1, filePath: "t.ts" } } as any,
      ],
      boilerplates: [], diagnostics: [], registerClasses: [], boardConstants: undefined,
      interfaces: [], namespaces: [], peripheralUsage: {}, requiredIncludes: [],
    } as unknown as ProgramIR;
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });

    expect(out.functions).toHaveLength(1);
    const stmts = out.functions[0]!.statements;
    // Original 2 statements + 1 injected companion = 3.
    expect(stmts).toHaveLength(3);
    expect((stmts[0] as any).operation.operation).toBe("gpio.set_mode");
    expect((stmts[1] as any).operation.operation).toBe("safety.record_pin_mode");
    expect((stmts[1] as any).operation.pin).toBe(7);
    expect((stmts[2] as any).operation.operation).toBe("gpio.read");
  });
});
