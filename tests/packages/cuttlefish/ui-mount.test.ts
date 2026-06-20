import { describe, it, expect } from "vitest";
import { resolveMount, MountValidationError } from "@typecad/cuttlefish/ir/transformers/ui-mount";
import type { PlatformGraphicsStrategy } from "@typecad/cuttlefish/api/shared";

function strategy(drivers: string[]): PlatformGraphicsStrategy {
  return {
    supportedDisplayDrivers: () => new Set(drivers),
    colorFormat: () => "rgb565",
    graphicsCapacity: () => ({ maxNodes: 256, maxBindings: 64, maxActiveTransitions: 32, nodeStorage: "flash" as const }),
    resolveDisplayOp: () => undefined,
  };
}

describe("ui.mount resolver", () => {
  it("returns a display.init op when the driver is supported", () => {
    const op = resolveMount(
      { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 },
      strategy(["ili9341"]),
      { width: 240, height: 320 },
    );
    expect(op.operation).toBe("display.init");
    expect(op.driver).toBe("ili9341");
    expect(op.width).toBe(240);
  });

  it("throws MountValidationError when the driver is unsupported", () => {
    expect(() =>
      resolveMount({ display: "st7789", bus: "SPI", cs: 10, dc: 9, rst: 8 }, strategy(["ili9341"]), { width: 240, height: 320 }),
    ).toThrow(MountValidationError);
  });

  it("error message lists the supported drivers", () => {
    try {
      resolveMount({ display: "st7789", bus: "SPI", cs: 10, dc: 9, rst: 8 }, strategy(["ili9341"]), { width: 240, height: 320 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("ili9341");
    }
  });
});
