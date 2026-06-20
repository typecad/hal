// ---------------------------------------------------------------------------
// ILI9341 — display driver resolver built on the Adafruit_ILI9341 library.
//
// Maps each DisplayHALOp to a method call on a library-instantiated
// Adafruit_ILI9341 object. The library owns SPI, command sequences, fonts,
// and glyph rendering — we own the tree, layout, and reactive driver.
//
// The framework instantiates one library object per mount; ui.mount's
// display.init emits the constructor + begin() + setRotation(), and
// subsequent ops reference the same object by name (__tc_display).
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "@typecad/cuttlefish/api/shared";

/** Display-side object variable name (instantiated by display.init). */
export const DISPLAY_VAR = "__tc_display";

/** The library's required headers — emitted as forced includes. */
export const ILI9341_INCLUDES = ["<Adafruit_GFX.h>", "<Adafruit_ILI9341.h>"];

export interface ILI9341Context {
  bus: string;
  cs: number;
  dc: number;
  rst: number;
  width: number;
  height: number;
}

/** Render a color value as a C++ hex literal (e.g. 0x07e0) for readable RGB565. */
function hexColor(c: number): string {
  return `0x${c.toString(16)}`;
}

/**
 * Resolve a display HAL op to a method call on the Adafruit_ILI9341 object.
 * Returns undefined for ops this driver does not handle.
 */
export function resolveILI9341Op(
  op: DisplayHALOp,
  ctx: ILI9341Context,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      // Hardware-SPI constructor: tft(CS, DC, RST). begin() initializes the
      // panel; setRotation(1) is landscape (width 240 x height 320).
      return {
        code: [
          `Adafruit_ILI9341 ${DISPLAY_VAR} = Adafruit_ILI9341(${ctx.cs}, ${ctx.dc}, ${ctx.rst});`,
          `${DISPLAY_VAR}.begin();`,
          `${DISPLAY_VAR}.setRotation(1);`,
          `${DISPLAY_VAR}.fillScreen(0x0000);`,
        ].join("\n"),
      };
    case "display.fill_rect":
      // Adafruit_GFX fillRect(x, y, w, h, color) — color is uint16 RGB565.
      return {
        code: `${DISPLAY_VAR}.fillRect(${op.x}, ${op.y}, ${op.w}, ${op.h}, ${hexColor(op.color)});`,
      };
    case "display.draw_rect":
      return {
        code: `${DISPLAY_VAR}.drawRect(${op.x}, ${op.y}, ${op.w}, ${op.h}, ${hexColor(op.color)});`,
      };
    case "display.draw_text":
      // Set cursor + color + size, then print. print() is the Print mixin
      // (not in the auto-gen d.ts but present on the real C++ object).
      return {
        code: [
          `${DISPLAY_VAR}.setCursor(${op.x}, ${op.y});`,
          `${DISPLAY_VAR}.setTextColor(${hexColor(op.color)});`,
          `${DISPLAY_VAR}.setTextSize(2);`,
          `${DISPLAY_VAR}.print(${JSON.stringify(op.text)});`,
        ].join("\n"),
      };
    case "display.flush":
      // ILI9341 is immediate — draws go straight to the panel. No flush.
      return { code: `/* flush: ${op.rects.length} rect(s) — immediate draw */` };
    default:
      return undefined;
  }
}
