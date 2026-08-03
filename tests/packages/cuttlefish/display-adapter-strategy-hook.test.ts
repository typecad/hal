import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import type { ResolvedDisplay } from "../../../packages/cuttlefish/src/api/shared/display-profile";
import type { DisplayAdapterCode } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

// A fake strategy that claims to provide its own adapter and returns a marker.
const fakeStrategy: any = {
  providesDisplayAdapter: () => true,
  resolveDisplayAdapter: (_d: ResolvedDisplay): DisplayAdapterCode => ({
    includes: "// NATIVE INCLUDES",
    declaration: "// NATIVE DECL",
    functions: "// NATIVE FN",
  }),
};

const fallbackStrategy: any = {
  providesDisplayAdapter: () => false,
};

const noHookStrategy: any = {}; // no providesDisplayAdapter at all

const base: ResolvedDisplay = {
  driver: "ili9341",
  width: 240,
  height: 320,
  colorFormat: "rgb565",
  _mountCs: 10,
  _mountDc: 9,
  _mountRst: 8,
  _mountBus: "SPI",
  _mountAddress: 0x3c,
  _mountReset: -1,
} as any;

describe("generateDisplayAdapter strategy hook", () => {
  it("uses strategy.resolveDisplayAdapter when providesDisplayAdapter() is true", () => {
    const a = generateDisplayAdapter(base, fakeStrategy);
    expect(a.includes).toBe("// NATIVE INCLUDES");
    expect(a.declaration).toBe("// NATIVE DECL");
    expect(a.functions).toBe("// NATIVE FN");
  });

  it("throws when the strategy opts out and no built-in adapter exists for the driver", () => {
    // After decoupling, Adafruit adapters are strategy-owned (framework-arduino).
    // A strategy that opts out + a driver with no built-in generic adapter is an
    // error, not a silent Adafruit fallback.
    expect(() => generateDisplayAdapter(base, fallbackStrategy)).toThrow(/No display adapter/);
  });

  it("throws when no strategy is passed and the driver has no built-in adapter", () => {
    expect(() => generateDisplayAdapter(base)).toThrow(/No display adapter/);
  });

  it("throws when strategy has no hook and the driver has no built-in adapter", () => {
    expect(() => generateDisplayAdapter(base, noHookStrategy)).toThrow(/No display adapter/);
  });
});
