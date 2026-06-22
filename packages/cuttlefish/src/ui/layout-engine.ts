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

/** Measure a node's intrinsic size. Accounts for the Adafruit GFX font metrics
 *  and the text size the draw dispatch will use. */
export function measure(node: StyledNode): IntrinsicSize {
  if (node.tag === "text" || node.tag === "button" || node.tag === "select") {
    const text = node.text ?? "";
    return { w: text.length * GFX_ADVANCE_PER_CHAR, h: GFX_CHAR_HEIGHT };
  }
  if (node.tag === "check") {
    // Checkbox: 16px square + 6px gap + label text
    const text = node.text ?? "";
    return { w: 16 + 6 + text.length * GFX_ADVANCE_PER_CHAR, h: GFX_CHAR_HEIGHT };
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}
