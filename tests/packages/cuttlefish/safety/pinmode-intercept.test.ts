import { describe, it, expect } from "vitest";
import { pinModeInterceptPass } from "../../../../packages/cuttlefish/src/safety/passes/pinMode-intercept";
import { TrackedMode } from "../../../../packages/cuttlefish/src/safety/hal/ops";
import type { ProgramIR, StatementIR } from "../../../../packages/cuttlefish/src/api/shared";

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

describe("pinModeInterceptPass (v3 — scans gpio.configure/gpio.read_cfg)", () => {
  it("injects a record_pin_mode companion after gpio.configure with a plain input", () => {
    const prog = programWith([
      halOp("gpio.configure", { pin: 5, flags: "GPIO.INPUT" }),
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
      halOp("gpio.configure", { pin: 7, flags: "GPIO.INPUT | GPIO.PULL_UP" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.InputPullup);
  });

  it("maps INPUT_PULLDOWN to TrackedMode.InputPulldown", () => {
    const prog = programWith([
      halOp("gpio.configure", { pin: 9, flags: "GPIO.INPUT | GPIO.PULL_DOWN" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.InputPulldown);
  });

  it("maps OUTPUT to TrackedMode.Output", () => {
    const prog = programWith([
      halOp("gpio.configure", { pin: 11, flags: "GPIO.OUTPUT" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.Output);
  });

  it("records open-drain output as TrackedMode.Output (the voter rejects reads on it)", () => {
    const prog = programWith([
      halOp("gpio.configure", { pin: 13, flags: "GPIO.OUTPUT_OPEN_DRAIN" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.Output);
  });

  it("maps runtime-expression flags to TrackedMode.Unknown", () => {
    const prog = programWith([
      halOp("gpio.configure", { pin: 14, flags: "(mode & 0x2) ? GPIO.OUTPUT : GPIO.INPUT" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.Unknown);
  });

  it("leaves non-configuring hal-ops untouched", () => {
    const prog = programWith([
      halOp("gpio.write", { pin: 5, value: 1 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(1);
  });

  it("does NOT scan the removed gpio.set_mode / gpio.pin_mode strings (regression guard)", () => {
    // Neither string exists in the canonical HALOpIR union anymore. If a
    // future change reintroduces either scan string, this test fails.
    const prog = programWith([
      halOp("gpio.set_mode", { pin: 5, mode: "INPUT" }),
      halOp("gpio.pin_mode", { pin: 6, mode: 0 }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(2); // no companions injected
  });

  it("also injects a companion after the fused gpio.read_cfg op", () => {
    const prog = programWith([
      halOp("gpio.read_cfg", { pin: 3, flags: "GPIO.INPUT | GPIO.PULL_UP" }),
    ]);
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(2);
    expect((out.topLevelStatements[1] as any).operation.operation).toBe("safety.record_pin_mode");
    expect((out.topLevelStatements[1] as any).operation.mode).toBe(TrackedMode.InputPullup);
  });
});
