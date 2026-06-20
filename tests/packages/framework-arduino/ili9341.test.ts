import { describe, it, expect } from "vitest";
import { resolveILI9341Op, ILI9341Context } from "@typecad/framework-arduino/graphics/ili9341";
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

const ctx: ILI9341Context = { bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320 };

describe("ILI9341 op resolver", () => {
  it("display.init sequences reset + SPI begin", () => {
    const op: DisplayHALOp = { operation: "display.init", ...ctx, driver: "ili9341" };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain("digitalWrite(8, HIGH)");
    expect(out).toContain("SPI.begin()");
    expect(out).toContain("SPI_CLOCK_DIV2");
  });

  it("display.fill_rect sets addr window and fills w*h pixels", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain("transfer(0x2A)");
    // ILI9341 address window = [start, end] coords. width 240 from x=0 → end col 239.
    expect(out).toContain("transfer16(239)");
    expect(out).toContain("transfer16(319)");   // height 320 from y=0 → end row 319
    expect(out).toMatch(/240\) \* \(320\)/);    // w*h pixel fill loop
    expect(out).toContain("transfer16(0x7e0)"); // hex color
  });

  it("display.draw_text emits __tc_draw_text helper call", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain('__tc_draw_text(8, 8, "hi", "8x16", 0xffff');
  });

  it("display.draw_rect emits 4 outline edges", () => {
    const op: DisplayHALOp = { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    // 4 distinct addr-window opens (0x2A appears once per edge)
    const matches = out.match(/0x2A/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it("display.flush is a no-op comment for ILI9341", () => {
    const op: DisplayHALOp = { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toMatch(/flush/);
  });
});
