import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import type { ProgramIR, StatementIR } from "../../../packages/cuttlefish/src/api/shared";

// Build a minimal ProgramIR that does/doesn't use safety.* ops.
function programWithSafetyOps(usesSafety: boolean): ProgramIR {
  const statements: StatementIR[] = [];
  if (usesSafety) {
    statements.push({
      kind: "hal-op",
      operation: { operation: "safety.read_safe", pin: 5 },
      sourceSpan: { startLine: 1, startColumn: 1, filePath: "t.ts" },
      returns_value: false,
    } as unknown as StatementIR);
  }
  return {
    fileName: "t.ts", imports: [], reExports: [], structs: [], enums: [],
    classes: [], typeAliases: [], topLevelStatements: statements, functions: [],
    boilerplates: [], diagnostics: [], registerClasses: [], boardConstants: undefined,
    interfaces: [], namespaces: [], peripheralUsage: {}, requiredIncludes: [],
  } as unknown as ProgramIR;
}

describe("ArduinoStrategy __tc_gpio_read shim", () => {
  it("emits __tc_gpio_read when the program uses safety.* ops", () => {
    const strategy = new ArduinoStrategy();
    const program = programWithSafetyOps(true);
    const lines = strategy.shimLines(program);
    const joined = lines.join("\n");
    expect(joined).toContain("__tc_gpio_read");
    expect(joined).toContain("digitalRead(pin)");
  });

  it("does NOT emit __tc_gpio_read when the program does not use safety", () => {
    const strategy = new ArduinoStrategy();
    const program = programWithSafetyOps(false);
    const lines = strategy.shimLines(program);
    const joined = lines.join("\n");
    expect(joined).not.toContain("__tc_gpio_read");
  });
});
