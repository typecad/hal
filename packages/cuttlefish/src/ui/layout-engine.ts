// ---------------------------------------------------------------------------
// Layout engine — pluggable, staged layout.
//
//   style tree  →  measure pass  →  arrange pass (engine)  →  computed boxes
//
// v1 ships BlockLayoutEngine only. The LayoutEngine interface + measure()
// are built so that FlexLayoutEngine (v2) is a pure addition: no rewrite of
// measure, the style tree, the node representation, or the draw layer.
//
// measure() is general (returns intrinsic {w,h}) even though block layout
// only needs it for text — flex reuses it for flex-basis:content.
// ---------------------------------------------------------------------------

import { StyledNode } from "./style-resolver.js";

export interface Box { x: number; y: number; w: number; h: number; }

export interface IntrinsicSize { w: number; h: number; }

export interface LayoutEngine {
  /** Engine id, used to select on the `display` style property. */
  readonly id: "block" | "flex" | "grid";
  /**
   * Arrange a styled tree into a flat list of boxes (pre-order, root first).
   * measureFn provides intrinsic sizes (e.g. text dimensions from the font).
   */
  arrange(
    root: StyledNode,
    viewport: Box,
    measureFn: (node: StyledNode) => IntrinsicSize,
  ): Box[];
}

// The Adafruit GFX default font: 5×7 pixel glyphs, 6px advance width per char.
// At setTextSize(N), advance = 6×N, height = 8×N (7 glyph + 1 descender line).
// The draw dispatch in the runtime header uses setTextSize(2).
const GFX_TEXT_SIZE = 2;
const GFX_ADVANCE_PER_CHAR = 6 * GFX_TEXT_SIZE;  // 12px at size 2
const GFX_CHAR_HEIGHT = 8 * GFX_TEXT_SIZE;       // 16px at size 2

/** Compute the GFX text size from a node's CSS font-size + font-weight.
 *  Mirrors the logic in model.ts textSizeOf(). */
function gfxTextSizeOf(node: StyledNode): number {
  let size = GFX_TEXT_SIZE;
  if (node.style.fontSize) {
    const px = parseInt(node.style.fontSize, 10);
    if (!isNaN(px)) {
      if (px <= 12) size = 1;
      else if (px <= 20) size = 2;
      else if (px <= 28) size = 3;
      else size = 4;
    }
  }
  if (node.style.fontWeight === "bold" && size < 4) size++;
  return size;
}

/** Measure a node's intrinsic size. Accounts for the Adafruit GFX font metrics
 *  and the text size the draw dispatch will use. */
export function measure(node: StyledNode): IntrinsicSize {
  // Per-node text size (from font-size + font-weight CSS).
  const ts = gfxTextSizeOf(node);
  const advance = 6 * ts;
  const charH = 8 * ts;
  if (node.tag === "text" || node.tag === "button" || node.tag === "select") {
    if (node.tag === "select") {
      // Size to the longest option, not the full comma-separated text
      const options = node.options && node.options.length > 0
        ? node.options.map((option) => option.text)
        : (node.text ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const longest = options.length > 0 ? options.reduce((a, b) => a.length >= b.length ? a : b) : "";
      return { w: longest.length * advance, h: charH };
    }
    const text = node.text ?? "";
    return { w: text.length * advance, h: charH };
  }
  if (node.tag === "check" || node.tag === "radio") {
    // Checkbox/radio: 16px indicator + 6px gap + label text
    const text = node.text ?? "";
    return { w: 16 + 6 + text.length * advance, h: Math.max(charH, 16) };
  }
  if (node.tag === "progress") {
    // Progress bar: default 200px wide, 12px tall
    return { w: 200, h: 12 };
  }
  if (node.tag === "range") {
    // Slider: default 200px wide, 20px tall (roomy track for touch)
    return { w: 200, h: 20 };
  }
  if (node.tag === "input") {
    // Input field: sized to the placeholder or a default width, 20px tall.
    const text = node.placeholder ?? "";
    const textW = text.length > 0 ? text.length * GFX_ADVANCE_PER_CHAR : 120;
    return { w: Math.max(textW + 16, 120), h: 20 };
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}
