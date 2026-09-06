// ---------------------------------------------------------------------------
// Tests for emit-time type specializations (Category B).
//
// These verify that the transpiler uses information g++ cannot recover to
// emit smaller/better C++:
//   - Enum narrowing: the full value range is known, so the narrowest
//     underlying type is picked (uint8_t for small enums, saving a byte per
//     field on AVR where default int is 2 bytes).
//   - let→const promotion: whole-program reassignment analysis proves a let
//     is never written after init, so it's emitted as const (enabling ROM
//     placement and constant folding).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { narrowestEnumUnderlying, resolveEnumValues } from "../../../packages/cuttlefish/src/emit/utils/cpp-helpers";

const AVR_CTX = { platformContext: { architecture: "avr", frameworkData: { buildTarget: "arduino:avr:uno" } } };

// ===========================================================================
// B1: Enum narrowing
// ===========================================================================

describe("Enum narrowing (emit-time)", () => {
  describe("narrowestEnumUnderlying helper", () => {
    it("picks uint8_t for values in [0,255]", () => {
      expect(narrowestEnumUnderlying([0, 1, 2], true)).toBe(" : uint8_t");
      expect(narrowestEnumUnderlying([0, 255], false)).toBe(" : uint8_t");
    });

    it("picks int8_t for values in [-128,127] with negatives", () => {
      expect(narrowestEnumUnderlying([-1, 0, 1], true)).toBe(" : int8_t");
      expect(narrowestEnumUnderlying([-128, 127], true)).toBe(" : int8_t");
    });

    it("falls back to default int (no suffix) for values in int range", () => {
      expect(narrowestEnumUnderlying([0, 256], true)).toBe("");
      expect(narrowestEnumUnderlying([-129, 0], true)).toBe("");
      expect(narrowestEnumUnderlying([0, 1000], false)).toBe("");
    });

    it("widens to long on AVR when a value exceeds 16-bit int", () => {
      expect(narrowestEnumUnderlying([0, 40000], true)).toBe(" : long");
      expect(narrowestEnumUnderlying([-40000, 0], true)).toBe(" : long");
    });

    it("does NOT widen to long on 32-bit-int targets", () => {
      // On native/ESP32, int is 32-bit so 40000 fits — no suffix.
      expect(narrowestEnumUnderlying([0, 40000], false)).toBe("");
    });

    it("returns empty for an empty enum", () => {
      expect(narrowestEnumUnderlying([], true)).toBe("");
    });
  });

  describe("resolveEnumValues helper", () => {
    it("resolves explicit values", () => {
      expect(resolveEnumValues([{ value: 10 }, { value: 20 }])).toEqual([10, 20]);
    });

    it("auto-increments from 0 for members without explicit values", () => {
      expect(resolveEnumValues([{}, {}, {}])).toEqual([0, 1, 2]);
    });

    it("auto-increments from the last explicit value", () => {
      expect(resolveEnumValues([{ value: 5 }, {}, {}])).toEqual([5, 6, 7]);
    });

    it("handles negative explicit values", () => {
      expect(resolveEnumValues([{ value: -2 }, {}])).toEqual([-2, -1]);
    });
  });

  it("narrows a small enum to uint8_t in generated C++", () => {
    const r = transpile(
      `enum State { Off, On, Blinking }
       function setup(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp).toContain("enum class State : uint8_t {");
  });

  it("narrows a small enum with explicit values to uint8_t", () => {
    const r = transpile(
      `enum PinRole { Input = 0, Output = 1, PullUp = 2 }
       function setup(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp).toContain("enum class PinRole : uint8_t {");
  });

  it("narrows a small signed enum to int8_t", () => {
    const r = transpile(
      `enum Offset { Neg = -1, Zero = 0, Pos = 1 }
       function setup(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp).toContain("enum class Offset : int8_t {");
  });

  it("does NOT narrow an enum whose values exceed 255", () => {
    const r = transpile(
      `enum Code { Ok = 0, Warn = 256, Error = 500 }
       function setup(): void {}`,
      { target: "arduino", ...AVR_CTX },
    );
    // Values fit in AVR's 16-bit int, so default int (no suffix).
    expect(r.cpp).toMatch(/enum class Code \{/);
    expect(r.cpp).not.toContain("enum class Code : uint8_t");
  });


});

// ===========================================================================
// B2: let → const promotion
// ===========================================================================

describe("let → const promotion (emit-time)", () => {
  it("promotes a never-reassigned top-level let to const", () => {
    const r = transpile(
      `let counter = 0;
       function setup(): void { const _log1 = counter; }`,
      { target: "arduino", ...AVR_CTX },
    );
    expect(r.cpp).toMatch(/const\s+\w+\s+counter\s*=/);
  });

  it("does NOT promote a let that is reassigned", () => {
    const r = transpile(
      `let counter = 0;
       function setup(): void { counter = 5; const _log2 = counter; }`,
      { target: "arduino", ...AVR_CTX },
    );
    // The declaration line should not start with const.
    const declLine = r.cpp.split("\n").find(l => l.includes("counter") && l.includes("=") && !l.includes("//") && !l.includes("Serial"));
    expect(declLine).toBeDefined();
    expect(declLine!.trim().startsWith("const")).toBe(false);
  });

  it("does NOT promote a let reassigned in a different scope (closure)", () => {
    const r = transpile(
      `let flag = false;
       function setIt(): void { flag = true; }
       function setup(): void { setIt(); const _log3 = flag; }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "ownership-suggest-const");
    // flag IS reassigned (in setIt), so it should not be promoted.
    const flagDiags = diags.filter(d => (d as any).message?.includes("'flag'"));
    expect(flagDiags).toHaveLength(0);
  });

  it("emits an info diagnostic when promoting", () => {
    const r = transpile(
      `let x = 42;
       function setup(): void { const _log4 = x; }`,
      { target: "arduino", ...AVR_CTX },
    );
    const diags = r.diagnostics.filter(d => (d as any).code === "ownership-suggest-const");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect((diags[0] as any).severity).toBe("info");
    expect((diags[0] as any).message).toContain("never reassigned");
  });
});
