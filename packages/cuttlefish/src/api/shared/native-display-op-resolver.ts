// ---------------------------------------------------------------------------
// Shared display-op resolver for native (non-Arduino) display strategies.
//
// Both NativeAVRStrategy and Esp32Strategy override resolveDisplayOp to return
// undefined for display.* ops (the design intent: display ops are resolved
// through the adapter path, not per-op HAL lowering). But the HAL lowering
// layer still calls resolveDisplayOp for every display.* op emitted by user
// code (display.init via ui.mount, display.fill_rect/draw_rect/draw_text via
// direct HAL calls, display.flush per frame).
//
// Those ops need to lower to CALLS INTO the adapter surface — the same
// display_init() / display_targetFillRect() / etc. functions the Adafruit
// path calls. The native adapters emit those functions with identical
// signatures, so the lowering is identical across native strategies.
//
// This module provides that lowering. Each native strategy's resolveDisplayOp
// delegates here instead of returning undefined.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "./display-op-ir.js";

/** Render a color value as a C++ hex literal (e.g. 0x07e0) for readable RGB565. */
function hexColor(c: number): string {
  return `0x${c.toString(16)}`;
}

/**
 * Resolve a display HAL op to a call into the native adapter surface
 * (display_init / display_targetFillRect / etc.). Returns undefined for ops
 * this resolver does not handle.
 */
export function resolveNativeDisplayOp(
  op: DisplayHALOp,
): { code?: string; expression?: string } | undefined {
  switch (op.operation) {
    case "display.init":
      // The adapter's display_init() does bus setup, panel init sequence,
      // rotation, and the initial fillScreen. No backlight GPIO parameter
      // on native paths — the Adafruit-style backlight pin is handled in
      // the mount config if needed.
      return { code: `display_init();` };
    case "display.fill_rect":
      // Delegate to the polymorphic target draw so the same call works
      // whether the active target is the panel or an offscreen canvas.
      return {
        code: `display_targetFillRect(display_defaultTarget(), ${op.x}, ${op.y}, ${op.w}, ${op.h}, ${hexColor(op.color)});`,
      };
    case "display.draw_rect":
      return {
        code: `display_targetDrawRect(display_defaultTarget(), ${op.x}, ${op.y}, ${op.w}, ${op.h}, ${hexColor(op.color)});`,
      };
    case "display.draw_text":
      return {
        code: [
          `display_targetSetCursor(display_defaultTarget(), ${op.x}, ${op.y});`,
          `display_targetSetTextColor(display_defaultTarget(), ${hexColor(op.color)});`,
          `display_targetSetTextSize(display_defaultTarget(), 2);`,
          `display_targetPrint(display_defaultTarget(), ${JSON.stringify(op.text)});`,
        ].join("\n"),
      };
    case "display.flush":
      // Direct-mode panels (ILI9341, ST7796S) draw immediately — no flush.
      // Buffered panels (SSD1309) flush via display_partial_refresh, which
      // the runtime calls through display_partial_refresh directly (not via
      // HAL op) at frame end.
      return { code: `/* flush: ${op.rects.length} rect(s) — native display */` };
    default:
      return undefined;
  }
}
