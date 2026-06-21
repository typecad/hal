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

// The Adafruit GFX default font is 5×7 pixels per glyph. At setTextSize(N),
// each glyph is N× the base size, plus 1px spacing per glyph. So at size 2:
// width = (5*2 + 1) = 11px per char, height = 7*2 = 14px.
// The draw dispatch in the runtime header uses setTextSize(2).
const GFX_TEXT_SIZE = 2;
const GFX_BASE_GLYPH_W = 5;
const GFX_BASE_GLYPH_H = 7;

/** Measure a node's intrinsic size. Accounts for the Adafruit GFX font metrics
 *  and the text size the draw dispatch will use. */
export function measure(node: StyledNode): IntrinsicSize {
  if (node.tag === "text" || node.tag === "button") {
    const text = node.text ?? "";
    const charW = GFX_BASE_GLYPH_W * GFX_TEXT_SIZE + 1;  // +1px per-char spacing
    const charH = GFX_BASE_GLYPH_H * GFX_TEXT_SIZE;
    return { w: text.length * charW, h: charH };
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}
