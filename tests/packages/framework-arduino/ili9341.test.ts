import { describe, it, expect } from "vitest";
import { resolveILI9341Op, ILI9341Context, DISPLAY_VAR } from "@typecad/framework-arduino/graphics/ili9341";
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

const ctx: ILI9341Context = { bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320 };

describe("ILI9341 op resolver (Adafruit_ILI9341 library)", () => {
  it("display.init initializes the file-scope display object + backlight", () => {
    const op: DisplayHALOp = { operation: "display.init", ...ctx, driver: "ili9341" };
    const out = resolveILI9341Op(op, ctx)!.code!;
    // The display object is declared at file scope by the UI emitter;
    // display.init only calls begin/setRotation/backlight.
    expect(out).toContain(`${DISPLAY_VAR}.begin()`);
    expect(out).toContain(`${DISPLAY_VAR}.setRotation(1)`);
    expect(out).toContain(`${DISPLAY_VAR}.fillScreen(0x0000)`);
    expect(out).toContain("pinMode(17, OUTPUT)");   // backlight LED
  });

  it("display.fill_rect calls Adafruit_GFX fillRect", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 240, h: 320, color: 0x07e0 };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain(`${DISPLAY_VAR}.fillRect(0, 0, 240, 320, 0x7e0)`);
  });

  it("display.draw_text sets cursor + color + size, then prints", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain(`${DISPLAY_VAR}.setCursor(8, 8)`);
    expect(out).toContain(`${DISPLAY_VAR}.setTextColor(0xffff)`);
    expect(out).toContain(`${DISPLAY_VAR}.setTextSize(2)`);
    expect(out).toContain(`${DISPLAY_VAR}.print("hi")`);
  });

  it("display.draw_rect calls Adafruit_GFX drawRect", () => {
    const op: DisplayHALOp = { operation: "display.draw_rect", x: 0, y: 0, w: 10, h: 10, color: 0xffff };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toContain(`${DISPLAY_VAR}.drawRect(0, 0, 10, 10, 0xffff)`);
  });

  it("display.flush is a no-op comment for ILI9341 (immediate draw)", () => {
    const op: DisplayHALOp = { operation: "display.flush", rects: [{ x: 0, y: 0, w: 8, h: 16 }] };
    const out = resolveILI9341Op(op, ctx)!.code!;
    expect(out).toMatch(/flush/);
  });
});
