import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import { resolveAvrProfile, chipForBuildTarget } from "../../../packages/framework-avr/src/profile";
import { activeChip } from "../../../packages/framework-avr/src/chips/index.js";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

// AVR profile resolution: FQBN → chip selection + diagnostics.
//
// Before Phase 3 the chip was hardcoded at construction time; nothing read the
// config's buildTarget. Now resolveAvrProfile() maps the FQBN board segment
// to a descriptor and surfaces structured diagnostics for pins the selected
// chip cannot satisfy. These tests mirror the esp32c3/rp2040 profile tests.

const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

const ctx = (buildTarget: string): PlatformContext =>
  ({ frameworkData: { buildTarget } }) as PlatformContext;

/** A program with peripheral usage AND the arrays the parent resolver/diagnostic walker needs. */
const programWith = (peripheralUsage: object): ProgramIR => ({
  topLevelStatements: [],
  functions: [],
  classes: [],
  peripheralUsage,
} as any as ProgramIR);

describe("chipForBuildTarget (FQBN → chip)", () => {
  it("arduino:avr:uno -> ATmega328P", () => {
    expect(chipForBuildTarget("arduino:avr:uno").id).toBe("atmega328p");
  });
  it("arduino:avr:nano -> ATmega328P", () => {
    expect(chipForBuildTarget("arduino:avr:nano").id).toBe("atmega328p");
  });
  it("arduino:avr:mega -> ATmega2560", () => {
    expect(chipForBuildTarget("arduino:avr:mega").id).toBe("atmega2560");
  });
  it("unknown board -> ATmega328P (safe default)", () => {
    expect(chipForBuildTarget("arduino:avr:nonexistent").id).toBe("atmega328p");
  });
  it("undefined buildTarget -> ATmega328P (safe default)", () => {
    expect(chipForBuildTarget(undefined).id).toBe("atmega328p");
  });
});

describe("resolveAvrProfile", () => {
  it("selects and activates the chip matching the FQBN", () => {
    resolveAvrProfile(EMPTY_PROGRAM, ctx("arduino:avr:mega"));
    expect(activeChip.id).toBe("atmega2560");
  });

  it("returns the AVR forced includes", () => {
    const profile = resolveAvrProfile(EMPTY_PROGRAM, ctx("arduino:avr:uno"));
    expect(profile.forcedIncludes).toEqual(["<avr/io.h>"]);
  });

  it("returns the AVR symbol aliases", () => {
    const profile = resolveAvrProfile(EMPTY_PROGRAM, ctx("arduino:avr:uno"));
    expect(profile.symbolAliases["delay"]).toBe("_native_delay_ms");
    expect(profile.symbolAliases["noInterrupts"]).toBe("cli");
  });

  it("produces no diagnostics for a program with no peripheral usage", () => {
    const profile = resolveAvrProfile(EMPTY_PROGRAM, ctx("arduino:avr:uno"));
    expect(profile.diagnostics).toEqual([]);
  });
});

describe("invalid-pin diagnostics", () => {
  // A program that uses pin 40 as an output — valid on the 2560 (Port G PG1),
  // invalid on the 328P (which tops out at D19). The diagnostic must surface
  // with the avr-invalid-pin code only on the chip that lacks the pin.
  const programUsingPin40 = programWith({ outputPins: new Set([40]) });

  it("flags pin 40 as invalid on ATmega328P (out of range)", () => {
    const profile = resolveAvrProfile(programUsingPin40, ctx("arduino:avr:uno"));
    const diag = profile.diagnostics.find(d => d.code === "avr-invalid-pin");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.message).toMatch(/D40/);
  });

  it("does NOT flag pin 40 on ATmega2560 (D40 exists there)", () => {
    const profile = resolveAvrProfile(programUsingPin40, ctx("arduino:avr:mega"));
    const diag = profile.diagnostics.find(d => d.code === "avr-invalid-pin");
    expect(diag).toBeUndefined();
  });

  it("flags PWM on a non-PWM pin", () => {
    // Pin 4 is digital-only on the 328P (not in its PWM map), but is PWM on
    // the 2560 (OC0B). This proves the PWM-unsupported check is chip-aware.
    const program = programWith({ pwmPinsUsed: new Set([4]) });
    const profile = resolveAvrProfile(program, ctx("arduino:avr:uno"));
    const diag = profile.diagnostics.find(d => d.code === "avr-pwm-unsupported");
    expect(diag).toBeDefined();
    expect(diag?.message).toMatch(/D4/);
  });
});

describe("NativeAVRStrategy profile integration", () => {
  it("profileDiagnostics surfaces AVR pin diagnostics alongside parent diagnostics", () => {
    const strategy = new NativeAVRStrategy();
    const program = programWith({ outputPins: new Set([99]) });
    const diags = strategy.profileDiagnostics(program, ctx("arduino:avr:uno"));
    // The AVR invalid-pin diagnostic must be present.
    expect(diags.find(d => d.code === "avr-invalid-pin")).toBeDefined();
  });

  it("clearProfileCache resets the cached profile (next call re-resolves)", () => {
    const strategy = new NativeAVRStrategy();
    // Warm the cache with uno.
    strategy.forcedIncludes(EMPTY_PROGRAM, ctx("arduino:avr:uno"));
    // Clear and resolve mega — the active chip must switch.
    strategy.clearProfileCache();
    strategy.forcedIncludes(EMPTY_PROGRAM, ctx("arduino:avr:mega"));
    expect(activeChip.id).toBe("atmega2560");
  });
});
