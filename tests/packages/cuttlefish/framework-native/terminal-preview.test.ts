import { describe, it, expect } from "vitest";
import { resolveTerminalPreviewOp } from "../../../../packages/cuttlefish/src/frameworks/native/graphics/terminal-preview";
import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

describe("terminal preview resolver", () => {
  it("fill_rect emits a preview comment with ansi color", () => {
    const op: DisplayHALOp = { operation: "display.fill_rect", x: 0, y: 0, w: 10, h: 10, color: 0x07e0 };
    const out = resolveTerminalPreviewOp(op)!.code!;
    expect(out).toContain("preview fill_rect");
    expect(out).toContain("ansi=");
  });

  it("draw_text emits the text in a preview comment", () => {
    const op: DisplayHALOp = { operation: "display.draw_text", x: 8, y: 8, text: "hi", fontId: "8x16", color: 0xffff };
    const out = resolveTerminalPreviewOp(op)!.code!;
    expect(out).toContain('"hi"');
  });

  it("init emits driver + dimensions", () => {
    const op: DisplayHALOp = { operation: "display.init", bus: "SPI", cs: 10, dc: 9, rst: 8, width: 240, height: 320, driver: "ili9341" };
    const out = resolveTerminalPreviewOp(op)!.code!;
    expect(out).toContain("ili9341");
    expect(out).toContain("240x320");
  });
});
