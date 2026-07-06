// ---------------------------------------------------------------------------
// Tests for ESP32-S3 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const S3_CTX = { frameworkData: { buildTarget: "esp32:esp32s3:esp32s3" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-S3 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for esp32s3 (not the default profile)", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, S3_CTX);
      // The default profile also includes <Arduino.h>, so the discriminating
      // assertion is that no diagnostic complains about an unknown architecture
      // and the include is present.
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for esp32s3 (A0 is a known builtin global)", () => {
      // Build a program that references A0.
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, S3_CTX);
      // Because esp32s3 is now in CAPABILITY_TABLE with A0 as a builtinGlobal,
      // needsA0 is false and no shim is emitted.
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for esp32s3 after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      // isrFunctionAttribute() reads _cachedArch, which is only populated as a
      // side-effect of profile resolution. Prime it with an S3 context.
      strategy.forcedIncludes(EMPTY_PROGRAM, S3_CTX);
      expect(strategy.isrFunctionAttribute()).toBe("IRAM_ATTR ");
    });

    it("returns empty string for AVR (unchanged behavior)", () => {
      const strategy = new ArduinoStrategy();
      const avrCtx = { frameworkData: { buildTarget: "arduino:avr:uno" } } as PlatformContext;
      strategy.forcedIncludes(EMPTY_PROGRAM, avrCtx);
      expect(strategy.isrFunctionAttribute()).toBe("");
    });
  });
});
