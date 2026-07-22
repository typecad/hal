import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";

describe("NativeAVRStrategy.resolveDisplayOp override", () => {
  const s = new NativeAVRStrategy();

  it("lowers display.init to a call into the native adapter surface (display_init)", () => {
    const r = s.resolveDisplayOp({ operation: "display.init", bus: "SPI0", cs: 5, dc: 17, rst: 16, width: 320, height: 480 } as any);
    expect(r?.code).toContain("display_init()");
    // Must NOT reference the Adafruit object — that was the latent inheritance bug.
    expect(r?.code).not.toMatch(/__tc_display\.(init|begin)\(/);
  });

  it("lowers display.fill_rect to display_targetFillRect", () => {
    const r = s.resolveDisplayOp({ operation: "display.fill_rect", x: 0, y: 0, w: 10, h: 10, color: 0 } as any);
    expect(r?.code).toContain("display_targetFillRect");
    expect(r?.code).not.toMatch(/__tc_display\.fillRect/);
  });
});
