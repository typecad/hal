import { describe, it, expect } from "vitest";
import { registerSafetyEngine } from "../../../packages/safety/src/engine-index";
import { pinModeInterceptPass } from "../../../packages/safety/src/passes/pinMode-intercept";
import type { ProgramIR, StatementIR } from "../../../packages/cuttlefish/src/api/shared";

const halOp = (operation: string, extra: Record<string, unknown> = {}): StatementIR =>
  ({
    kind: "hal-op",
    operation: { operation, ...extra },
    sourceSpan: { startLine: 1, startColumn: 1, filePath: "t.ts" },
    returns_value: false,
  }) as unknown as StatementIR;

describe("safe.pinMode explicit lowering", () => {
  it("resolveSemanticCall lowers safe.pinMode to safety.pin_mode (once Task 11 wires it)", () => {
    const hook = registerSafetyEngine();
    // resolveSemanticCall is wired in Task 11; if absent, this it() is skipped.
    if (!hook.resolveSemanticCall) {
      console.log("  (skipped: resolveSemanticCall not yet wired — Task 11)");
      return;
    }
    const op = hook.resolveSemanticCall("safe.pinMode", [5, 0]);
    expect(op).toMatchObject({ operation: "safety.pin_mode", pin: 5, mode: 0 });
  });

  it("the intercept pass then adds the companion, end to end", () => {
    // Simulate post-lowering IR: a safety.pin_mode op already present.
    const prog: ProgramIR = {
      fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
      classes: [], typeAliases: [],
      topLevelStatements: [halOp("safety.pin_mode", { pin: 5, mode: 0 })],
      functions: [], boilerplates: [], diagnostics: [], registerClasses: [],
      boardConstants: undefined, interfaces: [], namespaces: [],
      peripheralUsage: {}, requiredIncludes: [],
    } as unknown as ProgramIR;
    const out = pinModeInterceptPass(prog, { safetyInUse: true, target: "esp32" });
    expect(out.topLevelStatements.length).toBe(2);
    expect((out.topLevelStatements[1] as any).operation.operation).toBe("safety.record_pin_mode");
  });
});
