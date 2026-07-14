import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const CTX = { frameworkData: { buildTarget: "rp2040:rp2040:rpipico2" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("RP2350 framework-arduino support", () => {
  it("forces <Arduino.h> include", () => {
    const result = resolveArduinoProfile(EMPTY_PROGRAM, CTX);
    expect(result.forcedIncludes).toContain("<Arduino.h>");
  });

  it("returns empty isrFunctionAttribute (no IRAM_ATTR on Cortex-M)", () => {
    const strategy = new ArduinoStrategy();
    strategy.forcedIncludes(EMPTY_PROGRAM, CTX);
    expect(strategy.isrFunctionAttribute()).toBe("");
  });
});
