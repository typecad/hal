import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";

describe("NativeAVRStrategy.resolveDisplayOp override", () => {
  const s = new NativeAVRStrategy();

  it("returns undefined for display.init (does not call Adafruit __tc_display path)", () => {
    const r = s.resolveDisplayOp({ operation: "display.init", bus: "SPI0", cs: 5, dc: 17, rst: 16, width: 320, height: 480 } as any);
    expect(r).toBeUndefined();
  });

  it("returns undefined for display.fill_rect", () => {
    const r = s.resolveDisplayOp({ operation: "display.fill_rect", x: 0, y: 0, w: 10, h: 10, color: 0 } as any);
    expect(r).toBeUndefined();
  });
});
