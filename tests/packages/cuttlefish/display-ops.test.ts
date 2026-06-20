import { describe, it, expect } from "vitest";
import type { HALOpIR, DisplayHALOp } from "@typecad/cuttlefish/api/shared";
import { DISPLAY_OPERATION_KINDS } from "@typecad/cuttlefish/api/shared";

describe("display HAL ops", () => {
  it("DisplayInitOp carries bus, pins, dimensions, and driver id", () => {
    const op: DisplayHALOp = {
      operation: "display.init",
      bus: "SPI",
      cs: 10, dc: 9, rst: 8,
      width: 240, height: 320,
      driver: "ili9341",
    };
    expect(op.operation).toBe("display.init");
    expect(op.driver).toBe("ili9341");
  });

  it("DisplayFillRectOp carries box and color", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 };
    expect(op.color).toBe(0x07e0);
  });

  it("DisplayDrawTextOp carries box, text, fontId, color", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    expect(op.text).toBe("hi");
  });

  it("DisplayDrawRectOp carries outline box and color", () => {
    const op: DisplayHALOp = { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff };
    expect(op.operation).toBe("display.draw_rect");
  });

  it("DisplayFlushOp carries dirty rects", () => {
    const op: DisplayHALOp = { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] };
    expect(op.rects).toHaveLength(1);
  });

  it("all display ops are members of HALOpIR", () => {
    const ops: HALOpIR[] = [
      { operation: "display.init", bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320, driver: "ili9341" },
      { operation: "display.fill_rect", x: 0, y: 0, w: 1, h: 1, color: 0 },
      { operation: "display.draw_text", x: 0, y: 0, text: "", fontId: "8x16", color: 0 },
      { operation: "display.draw_rect", x: 0, y: 0, w: 1, h: 1, color: 0 },
      { operation: "display.flush", rects: [] },
    ];
    expect(ops).toHaveLength(5);
  });

  // Runtime guard: `import type` is erased, so the type-only assertions above
  // pass vacuously. This case verifies the op discriminators are actually
  // exported at runtime — it fails meaningfully if an op is dropped.
  it("exports all five display operation discriminators at runtime", () => {
    expect(DISPLAY_OPERATION_KINDS).toEqual([
      "display.init",
      "display.fill_rect",
      "display.draw_text",
      "display.draw_rect",
      "display.flush",
    ]);
  });
});
