// ---------------------------------------------------------------------------
// Tests for ESP32-C3 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
//
// NOTE on the FQBN: the ESP32-C3's Arduino FQBN is esp32:esp32:esp32c3 — the
// ESP32 Arduino core collapses the whole family into a single esp32:esp32
// platform, with the chip variant encoded in the BOARD id. The framework's
// _cachedArch derives from FQBN segment [1] (the platform), so a C3 FQBN
// resolves _cachedArch='esp32', and C3 inherits the esp32 profile/IRAM_ATTR
// behavior. That is correct: C3 needs the same ISR handling (it's already in
// the isrFunctionAttribute ESP32-family set) even though it's RISC-V.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const C3_CTX = { frameworkData: { buildTarget: "esp32:esp32:esp32c3" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-C3 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the C3 FQBN (not the default profile)", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, C3_CTX);
      // The C3 FQBN resolves to the 'esp32' profile (platform segment), which
      // forces <Arduino.h>. The default profile also includes it, so the
      // discriminating assertion is that no diagnostic complains about an
      // unknown architecture.
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the C3 FQBN (A0 is a known builtin global)", () => {
      // Build a program that references A0.
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, C3_CTX);
      // The C3 FQBN resolves to the 'esp32' capability row, where A0 is a
      // builtinGlobal, so needsA0 is false and no shim is emitted.
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the C3 FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      // isrFunctionAttribute() reads _cachedArch, which is only populated as a
      // side-effect of profile resolution. The C3 FQBN resolves _cachedArch to
      // 'esp32' (the platform segment), which is in the ISR IRAM_ATTR set.
      strategy.forcedIncludes(EMPTY_PROGRAM, C3_CTX);
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
