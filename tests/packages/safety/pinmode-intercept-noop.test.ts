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

describe("pinModeInterceptPass no-op behavior", () => {
  it("returns the same program reference when safetyInUse is false", () => {
    const prog: ProgramIR = {
      fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
      classes: [], typeAliases: [],
      topLevelStatements: [halOp("gpio.pin_mode", { pin: 5, mode: 0 })],
      functions: [], boilerplates: [], diagnostics: [], registerClasses: [],
      boardConstants: undefined, interfaces: [], namespaces: [],
      peripheralUsage: {}, requiredIncludes: [],
    } as unknown as ProgramIR;
    const out = pinModeInterceptPass(prog, { safetyInUse: false, target: "esp32" });
    expect(out).toBe(prog); // identical reference
  });
});
