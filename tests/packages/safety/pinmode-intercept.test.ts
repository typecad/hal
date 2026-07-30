import { describe, it, expect } from "vitest";
import { pinModeInterceptPass } from "../../../packages/safety/src/passes/pinMode-intercept";
import { TrackedMode } from "../../../packages/safety/src/hal/ops";
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

describe("pinModeInterceptPass (v2 — scans gpio.set_mode)", () => {
  it("injects a record_pin_mode companion after gpio.set_mode with INPUT", () => {
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 5, mode: "INPUT" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(2);
    const companion = out.topLevelStatements[1] as any;
    expect(companion.operation.operation).toBe("safety.record_pin_mode");
    expect(companion.operation.pin).toBe(5);
    expect(companion.operation.mode).toBe(TrackedMode.Input);
  });

  it("maps INPUT_PULLUP to TrackedMode.InputPullup", () => {
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 7, mode: "INPUT_PULLUP" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.InputPullup);
  });

  it("maps INPUT_PULLDOWN to TrackedMode.InputPulldown", () => {
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 9, mode: "INPUT_PULLDOWN" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.InputPulldown);
  });

  it("maps OUTPUT to TrackedMode.Output", () => {
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 11, mode: "OUTPUT" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.Output);
  });

  it("maps unknown mode strings to TrackedMode.Unknown", () => {
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 13, mode: "BANANA" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.Unknown);
  });

  it("leaves non-set_mode hal-ops untouched", () => {
    const prog = programWith([
      halOp("gpio.write", { pin: 5, value: 1 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(1);
  });

  it("does NOT scan the v1 string gpio.pin_mode (regression guard)", () => {
    // gpio.pin_mode does not exist in the canonical HALOpIR union. If a
    // future change reintroduces this scan string, this test fails.
    const prog = programWith([
      halOp("gpio.pin_mode", { pin: 5, mode: 0 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(1); // no companion injected
  });
});
