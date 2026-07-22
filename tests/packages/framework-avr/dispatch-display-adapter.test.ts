import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";

describe("NativeAVRStrategy display-adapter dispatch", () => {
  const s = new NativeAVRStrategy();

  it("providesDisplayAdapter() is true", () => {
    expect(s.providesDisplayAdapter!()).toBe(true);
  });

  it("returns undefined for sdl (defers to built-in Adafruit registry)", () => {
    const r = s.resolveDisplayAdapter!({ driver: "sdl" } as any);
    expect(r).toBeUndefined();
  });

  it("returns undefined for unknown driver (defers to built-in)", () => {
    const r = s.resolveDisplayAdapter!({ driver: "unknown-driver" } as any);
    expect(r).toBeUndefined();
  });
});
