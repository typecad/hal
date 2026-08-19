import { describe, it, expect } from "vitest";
import { analyzeProgram } from "../../../packages/cuttlefish/src/ir/program-analysis";
import { buildProgramIR } from "../../../packages/cuttlefish/src/testing";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { setActiveStrategy } from "../../../packages/cuttlefish/src/ir/hal-resolver";
import { setLoadedFramework } from "../../../packages/cuttlefish/src/framework-registry";

const strat = new ArduinoStrategy();
setLoadedFramework({ strategy: strat });
setActiveStrategy(strat);

// Build a real ProgramIR by running the transpiler front-end on TypeScript
// source, then analyze it. This produces a complete, valid IR — far more
// reliable than hand-crafting IR fragments (which miss fields analyzeProgram
// walks). The injected `declare function` lines seed lowered `raw` expressions
// the analyzer's text-scan detects.
function analyzeSrc(src: string) {
  const program = buildProgramIR("test.ts", src);
  return analyzeProgram(program, strat);
}

describe("analyzeProgram new gating flags", () => {
  it("detects usesSet/usesAlgorithm/usesCstdio flags exist and are boolean", () => {
    // These fire on lowered raw text (e.g. native-target lowering emits
    // std::set/std::sort/printf). Their detection is exercised by
    // the broader native suite; here we confirm the flags exist on the result.
    const a = analyzeSrc(`export function f(): void {}`);
    expect(typeof a.usesSet).toBe("boolean");
    expect(typeof a.usesAlgorithm).toBe("boolean");
    expect(typeof a.usesCstdio).toBe("boolean");
  });

  it("detects usesDigitalRead from a hal-lowered InputPin read", () => {
    // A real program: importing a board pin and reading it lowers to a raw
    // digitalRead(...) expression the analyzer detects.
    const a = analyzeSrc(`
      import { D2 } from "@typecad/board-arduino-uno";
      D2.asInputPullUp();
      export function f(): number { return D2.read(); }
    `);
    expect(a.usesDigitalRead).toBe(true);
    expect(a.usesGPIO).toBe(true);
  });

  it("detects usesDisplay via a display hal-op", () => {
    // display.* hal-ops appear in IR when the program touches the display HAL.
    // Build a program whose IR carries a display.* op via the hal-op statement form.
    const program = {
      topLevelStatements: [{ kind: "hal-op", operation: { operation: "display.init", code: "" } }],
      functions: [],
      classes: [],
      namespaces: [],
      typeAliases: [],
      interfaces: [],
    } as unknown as import("../../../packages/cuttlefish/src/api/index.js").ProgramIR;
    const a = analyzeProgram(program, strat);
    expect(a.usesDisplay).toBe(true);
  });

  it("does NOT set usesDigitalRead when no pin is read", () => {
    const a = analyzeSrc(`export function f(): number { return 42; }`);
    expect(a.usesDigitalRead).toBe(false);
  });

  it("detects hasThrowStatements (cuttlefish_halt gating uses hasThrowStatements || usesHalt)", () => {
    // A throw lowers to cuttlefish_halt during emit (after analysis), so at the
    // IR stage usesHalt may be false — but hasThrowStatements is true, which is
    // what the cuttlefish_halt macro gate ORs with usesHalt.
    const a = analyzeSrc(`export function f(): void { throw new Error("boom"); }`);
    expect(a.hasThrowStatements).toBe(true);
  });

  it("initializes all new flags to false for a trivial program", () => {
    const a = analyzeSrc(`export function f(): void {}`);
    expect(a.usesSet).toBe(false);
    expect(a.usesAlgorithm).toBe(false);
    expect(a.usesCstdio).toBe(false);
    expect(a.usesDigitalRead).toBe(false);
    expect(a.usesDisplay).toBe(false);
    expect(a.usesHalt).toBe(false);
    expect(a.usesWallClock).toBe(false);
  });
});

describe("analyzeProgram wall-clock vs delay distinction", () => {
  it("sets usesWallClock for millis() but NOT for a delay-only program", () => {
    // delay() keeps usesMillis true (framework-avr derives its native timing
    // ISR gate from it) but must not read as a wall-clock consumer — Zephyr
    // lowers delay straight to k_msleep and gates its millis() shim on
    // usesWallClock.
    const delayOnly = analyzeSrc(`
      declare function delay(ms: number): void;
      export function f(): void { delay(1000); }
    `);
    expect(delayOnly.usesMillis).toBe(true);
    expect(delayOnly.usesWallClock).toBe(false);

    const clock = analyzeSrc(`
      declare function millis(): number;
      export function f(): number { return millis(); }
    `);
    expect(clock.usesWallClock).toBe(true);
    expect(clock.usesMillis).toBe(true);
  });
});

describe("analyzeProgram test-runner print helper tracking", () => {
  it("tracks __tc_print/__tc_println as used polyfill helpers", () => {
    // @typecad/expect's preprocessor injects these calls into the source
    // before IR build; frameworks gate their definitions (and <cstdio>) on
    // the helpers being present in this set.
    const a = analyzeSrc(`
      declare function __tc_print(s: string): void;
      declare function __tc_println(s: string): void;
      export function f(): void { __tc_print("marker"); __tc_println(5); }
    `);
    expect(a.usedPolyfillHelpers.has("__tc_print")).toBe(true);
    expect(a.usedPolyfillHelpers.has("__tc_println")).toBe(true);
  });

  it("does not track __tc_print when nothing calls it", () => {
    const a = analyzeSrc(`export function f(): void {}`);
    expect(a.usedPolyfillHelpers.has("__tc_print")).toBe(false);
    expect(a.usedPolyfillHelpers.has("__tc_println")).toBe(false);
  });
});
