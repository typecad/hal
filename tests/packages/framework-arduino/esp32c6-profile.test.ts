// ---------------------------------------------------------------------------
// Tests for ESP32-C6 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
//
// NOTE on the FQBN: the ESP32-C6's Arduino FQBN is esp32:esp32:esp32c6 — the
// ESP32 Arduino core collapses the family into esp32:esp32, with the chip
// variant in the BOARD id. _cachedArch derives from FQBN segment [1]
// (platform) → 'esp32', so the C6 inherits the esp32 profile/IRAM behavior.
// Correct: the C6 is RISC-V but the IRAM_ATTR requirement is an ESP32-family
// silicon fact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const C6_CTX = { frameworkData: { buildTarget: "esp32:esp32:esp32c6" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-C6 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the C6 FQBN", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, C6_CTX);
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the C6 FQBN (A0 is a known builtin global)", () => {
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, C6_CTX);
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the C6 FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      strategy.forcedIncludes(EMPTY_PROGRAM, C6_CTX);
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
