import { describe, it, expect } from "vitest";
import type { HALOpIR, DisplayHALOp } from "@typecad/cuttlefish/api/shared";
import { DISPLAY_OPERATION_KINDS } from "@typecad/cuttlefish/api/shared";

describe("display HAL ops", () => {
  // Compile-time check: assigning one representative of each operation kind to
  // `DisplayHALOp` / `HALOpIR` confirms the discriminated-union shapes are
  // well-formed (the required fields line up with each discriminator). This is
  // a type-level assertion — `import type` is erased at runtime — but a wrong
  // or dropped field fails the build here rather than going silent. The fields
  // used below are the ones specific to each op (bus/pins for init, rects for
  // flush, etc.), so a field rename shows up as a compile error.
  it("each display operation kind satisfies the DisplayHALOp / HALOpIR union", () => {
    const ops: HALOpIR[] = [
      { operation: "display.init", bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320, driver: "ili9341" },
      { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 },
      { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff },
      { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff },
      { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] },
    ];
    // Five distinct discriminators, one per kind.
    expect(ops.map((o) => o.operation)).toEqual([
      "display.init",
      "display.fill_rect",
      "display.draw_text",
      "display.draw_rect",
      "display.flush",
    ]);
  });

  // Runtime guard: `import type` is erased, so the type-only assertion above
  // passes vacuously at runtime. This case verifies the op discriminators are
  // actually exported at runtime — it fails meaningfully if an op is dropped
  // from DISPLAY_OPERATION_KINDS.
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
