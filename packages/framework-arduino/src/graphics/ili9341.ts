// ---------------------------------------------------------------------------
// ILI9341 — SPI color TFT driver resolver (240×320, RGB565)
//
// Translates DisplayHALOp nodes into Arduino SPI C++ commands targeting the
// ILI9341. Emits setAddrWindow + SPI.transfer16 for fills, and a per-glyph
// blit for text (font table provided by the runtime header).
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

/** Render a color value as a C++ hex literal (e.g. 0x07e0) for readable RGB565 output. */
function hexColor(c: number): string {
  return `0x${c.toString(16)}`;
}

export interface ILI9341Context {
  bus: string;
  cs: number;
  dc: number;
  rst: number;
  width: number;
  height: number;
}

/**
 * Resolve a display HAL op to ILI9341 SPI C++.
 * Returns undefined for ops this driver does not handle.
 */
export function resolveILI9341Op(
  op: DisplayHALOp,
  ctx: ILI9341Context,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      return {
        code: [
          `pinMode(${ctx.dc}, OUTPUT);`,
          `pinMode(${ctx.cs}, OUTPUT);`,
          `pinMode(${ctx.rst}, OUTPUT);`,
          `digitalWrite(${ctx.rst}, HIGH); delay(5);`,
          `digitalWrite(${ctx.rst}, LOW); delay(20);`,
          `digitalWrite(${ctx.rst}, HIGH); delay(150);`,
          `${ctx.bus}.begin();`,
          `${ctx.bus}.setBitOrder(MSBFIRST);`,
          `${ctx.bus}.setDataMode(SPI_MODE0);`,
          `${ctx.bus}.setClockDivider(SPI_CLOCK_DIV2);`,
        ].join("\n"),
      };
    case "display.fill_rect":
      return {
        code: [
          `digitalWrite(${ctx.cs}, LOW);`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2A);`,
          `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${op.x}); ${ctx.bus}.transfer16(${op.x + op.w - 1});`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2B);`,
          `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${op.y}); ${ctx.bus}.transfer16(${op.y + op.h - 1});`,
          `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2C);`,
          `digitalWrite(${ctx.dc}, HIGH);`,
          `for (uint32_t __i = 0; __i < (uint32_t)(${op.w}) * (${op.h}); __i++) ${ctx.bus}.transfer16(${hexColor(op.color)});`,
          `digitalWrite(${ctx.cs}, HIGH);`,
        ].join("\n"),
      };
    case "display.draw_rect": {
      // Outline = 4 fill_rects (top, bottom, left, right).
      const c = op.color;
      const lines: string[] = [`digitalWrite(${ctx.cs}, LOW);`];
      const rect = (x: number, y: number, w: number, h: number) => [
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2A);`,
        `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${x}); ${ctx.bus}.transfer16(${x + w - 1});`,
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2B);`,
        `digitalWrite(${ctx.dc}, HIGH); ${ctx.bus}.transfer16(${y}); ${ctx.bus}.transfer16(${y + h - 1});`,
        `digitalWrite(${ctx.dc}, LOW); ${ctx.bus}.transfer(0x2C);`,
        `digitalWrite(${ctx.dc}, HIGH);`,
        `for (uint32_t __i = 0; __i < (uint32_t)(${w}) * (${h}); __i++) ${ctx.bus}.transfer16(${c});`,
      ].join("\n");
      lines.push(rect(op.x, op.y, op.w, 1));                // top
      lines.push(rect(op.x, op.y + op.h - 1, op.w, 1));     // bottom
      lines.push(rect(op.x, op.y, 1, op.h));                // left
      lines.push(rect(op.x + op.w - 1, op.y, 1, op.h));     // right
      lines.push(`digitalWrite(${ctx.cs}, HIGH);`);
      return { code: lines.join("\n") };
    }
    case "display.draw_text":
      // Defer glyph blit to a runtime helper that takes the font id.
      return {
        code: `__tc_draw_text(${op.x}, ${op.y}, "${op.text}", "${op.fontId}", ${hexColor(op.color)}, &${ctx.bus}, ${ctx.cs}, ${ctx.dc});`,
      };
    case "display.flush":
      // ILI9341 has no separate flush — draws go straight to the panel.
      return { code: `/* flush: ${op.rects.length} rect(s) — already drawn */` };
    default:
      return undefined;
  }
}
