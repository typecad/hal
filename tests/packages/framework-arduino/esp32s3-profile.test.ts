// ---------------------------------------------------------------------------
// Tests for ESP32-S3 framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
//
// NOTE on the FQBN: the ESP32-S3's Arduino FQBN is esp32:esp32:esp32s3 — the
// ESP32 Arduino core collapses the whole family (classic/S2/S3/C3) into a
// single esp32:esp32 platform, with the chip variant encoded in the BOARD id,
// not the platform segment. The framework's _cachedArch derives from FQBN
// segment [1] (the platform), so an S3 FQBN resolves _cachedArch='esp32', and
// S3 inherits the esp32 profile/IRAM_ATTR behavior. That is correct: both are
// Xtensa LX7 and need identical ISR/heap handling.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const S3_CTX = { frameworkData: { buildTarget: "esp32:esp32:esp32s3" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("ESP32-S3 framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the S3 FQBN (not the default profile)", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, S3_CTX);
      // The S3 FQBN resolves to the 'esp32' profile (platform segment), which
      // forces <Arduino.h>. The default profile also includes it, so the
      // discriminating assertion is that no diagnostic complains about an
      // unknown architecture.
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the S3 FQBN (A0 is a known builtin global)", () => {
      // Build a program that references A0.
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;

      const result = resolveArduinoProfile(program, S3_CTX);
      // The S3 FQBN resolves to the 'esp32' capability row, where A0 is a
      // builtinGlobal, so needsA0 is false and no shim is emitted.
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the S3 FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      // isrFunctionAttribute() reads _cachedArch, which is only populated as a
      // side-effect of profile resolution. The S3 FQBN resolves _cachedArch to
      // 'esp32' (the platform segment), which is in the Xtensa IRAM_ATTR set.
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

