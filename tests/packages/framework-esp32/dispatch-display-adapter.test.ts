import { describe, it, expect } from "vitest";
import { Esp32Strategy } from "../../../packages/framework-esp32/src/strategy";
import { lowerHalOp } from "../../../packages/framework-esp32/src/lowering";

describe("Esp32Strategy display-adapter dispatch", () => {
  const s = new Esp32Strategy();

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

describe("lowerHalOp no longer throws on display.* (handled by adapter)", () => {
  it("display.init is NOT thrown by lowerHalOp (dead code path)", () => {
    // display.* ops never reach lowerHalOp in practice — they're resolved at
    // adapter-emission time, before HAL lowering. The throw that used to be at
    // index.ts:46 was unreachable defensive code and is now removed.
    expect(() => lowerHalOp({ operation: "display.init" } as any)).not.toThrow(/does not yet support display/);
  });
});
