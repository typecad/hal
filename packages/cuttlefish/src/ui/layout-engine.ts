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

import { StyledNode } from "./style-resolver";

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

const FONT_REGISTRY: Record<string, { w: number; h: number }> = {
  "8x16": { w: 8, h: 16 },
  "6x8": { w: 6, h: 8 },
};

const DEFAULT_FONT = "8x16";

/** Measure a node's intrinsic size. Currently: text length × font cell. */
export function measure(node: StyledNode): IntrinsicSize {
  if (node.tag === "text" || node.tag === "button") {
    const fontId = node.style.font ?? DEFAULT_FONT;
    const font = FONT_REGISTRY[fontId] ?? FONT_REGISTRY[DEFAULT_FONT];
    const text = node.text ?? "";
    return { w: text.length * font.w, h: font.h };
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}
