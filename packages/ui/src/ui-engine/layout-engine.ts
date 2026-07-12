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
import { layoutText } from "./text-layout.js";
import { layoutRuns } from "./rich-layout.js";
import { assetTextWidth } from "./font-assets.js";
import type { UIFontAssetModel } from "./font-assets.js";

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
    measureFn: (node: StyledNode, availableWidth?: number) => IntrinsicSize,
  ): Box[];
}

/** Static display:none predicate shared by layout engines and lowering. */
export function isDisplayNone(node: StyledNode): boolean {
  return node.style.display?.trim().toLowerCase() === "none";
}

/** Parse CSS aspect-ratio values: "16 / 9", "1/1", or "1.777". */
export function parseAspectRatio(value: string | undefined): number | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw || raw === "auto") return undefined;
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const ratio = parseFloat(parts[0]);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  }
  if (parts.length === 2) {
    const width = parseFloat(parts[0]);
    const height = parseFloat(parts[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
  }
  return undefined;
}

// The Adafruit GFX default font: 5×7 pixel glyphs, 6px advance width per char.
// At setTextSize(N), advance = 6×N, height = 8×N (7 glyph + 1 descender line).
// The draw dispatch in the runtime header uses setTextSize(2).
const GFX_TEXT_SIZE = 2;
const GFX_ADVANCE_PER_CHAR = 6 * GFX_TEXT_SIZE;  // 12px at size 2
const GFX_CHAR_HEIGHT = 8 * GFX_TEXT_SIZE;       // 16px at size 2

/** Compute the GFX text size from a node's CSS font-size.
 *  Mirrors the logic in model.ts textSizeOf(). font-weight does NOT inflate
 *  the bucket (matching web behavior); see model.ts:textSizeOf for rationale. */
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
  return size;
}

function letterSpacingOf(node: StyledNode): number {
  if (!node.style.letterSpacing) return 0;
  const px = parseInt(node.style.letterSpacing, 10);
  return Number.isFinite(px) ? px : 0;
}

function lineHeightOf(node: StyledNode, charH: number): number {
  const raw = node.style.lineHeight?.trim();
  if (!raw || raw === "normal") return charH;
  if (raw.endsWith("%")) {
    const pct = parseFloat(raw);
    return Number.isFinite(pct) ? Math.max(1, Math.round(charH * pct / 100)) : charH;
  }
  if (/^-?\d*\.?\d+$/.test(raw)) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? Math.max(1, Math.round(charH * n)) : charH;
  }
  const px = parseInt(raw, 10);
  return Number.isFinite(px) && px > 0 ? px : charH;
}

function applyTextTransform(text: string | undefined, node: StyledNode): string {
  const value = text ?? "";
  switch (node.style.textTransform) {
    case "uppercase": return value.toUpperCase();
    case "lowercase": return value.toLowerCase();
    case "capitalize": return value.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return value;
  }
}

function textWidthOf(text: string, advance: number): number {
  let w = 0;
  for (const _ch of text) w += advance;
  return w;
}

/** Measure a node's intrinsic size. Accounts for the Adafruit GFX font metrics
 *  and the text size the draw dispatch will use. When `fontAssets` is provided,
 *  text widths use the real per-glyph advances of any matching custom
 *  @font-face (the runtime draws at those advances); otherwise they fall back
 *  to the 6*ts default-font advance. */
export function measure(node: StyledNode, availableWidth?: number, fontAssets: UIFontAssetModel[] = []): IntrinsicSize {
  // Rich-text (inline runs): size the node from its multi-run layout. Each run
  // is measured at its own font/size advance (per-run style), and the laid-out
  // width/height drive the node's box. This keeps flex sizing in sync with the
  // precomputed runLines the lowering bakes (and the runtime draws).
  if (node.runs && node.runs.length > 0) {
    const layoutInput = node.runs.map(r => {
      const rs = { ...node.style, ...r.style } as typeof node.style;
      const rTs = gfxTextSizeOf({ ...node, style: rs });
      const rAdvance = 6 * rTs + letterSpacingOf({ ...node, style: rs });
      return {
        text: applyTextTransform(r.text, { ...node, style: rs }),
        hardBreak: r.hardBreak,
        measureText: (s: string) => assetTextWidth(s, rs, fontAssets) ?? textWidthOf(s, rAdvance),
        height: 8 * rTs,
        ascent: 7 * rTs,
      };
    });
    const layout = layoutRuns(layoutInput, { maxWidth: availableWidth, whiteSpace: node.style.whiteSpace });
    return { w: layout.width, h: layout.height };
  }
  // Per-node text size (from font-size + font-weight CSS).
  const ts = gfxTextSizeOf(node);
  const advance = 6 * ts + letterSpacingOf(node);
  const charH = 8 * ts;
  // For interpolation text (e.g. "taps: {count}"), strip the braces so layout
  // measures "taps: count" — closer to the resolved runtime width than the
  // literal "{count}". The braces are an authoring delimiter, not rendered.
  const stripInterp = (value: string | undefined): string =>
    node.hasInterpolation ? (value ?? "").replace(/[{}]/g, "") : (value ?? "");
  // Width of a string using the asset font's real advances when the node has
  // one, else the 6*ts default-font advance. This keeps the measured box width
  // in sync with what the runtime actually draws (avoids overflow/clipping).
  const widthOf = (value: string): number =>
    assetTextWidth(stripInterp(value), node.style, fontAssets) ?? textWidthOf(stripInterp(value), advance);
  if (node.tag === "text" || node.tag === "button" || node.tag === "select") {
    if (node.tag === "select") {
      // Size to the longest option, not the full comma-separated text
      const options = node.options && node.options.length > 0
        ? node.options.map((option) => option.text)
        : (node.text ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const longest = options.length > 0 ? options.reduce((a, b) => a.length >= b.length ? a : b) : "";
      return { w: widthOf(applyTextTransform(longest, node)), h: lineHeightOf(node, charH) };
    }
    const text = applyTextTransform(stripInterp(node.text), node);
    const layout = layoutText(text, {
      maxWidth: availableWidth,
      whiteSpace: node.style.whiteSpace,
      lineHeight: lineHeightOf(node, charH),
      measureText: widthOf,
    });
    return { w: layout.width, h: layout.height };
  }
  if (node.tag === "check" || node.tag === "radio") {
    // Checkbox/radio: 16px indicator + 6px gap + label text
    const text = applyTextTransform(stripInterp(node.text), node);
    const labelMaxWidth = availableWidth !== undefined ? Math.max(0, availableWidth - 22) : undefined;
    const layout = layoutText(text, {
      maxWidth: labelMaxWidth,
      whiteSpace: node.style.whiteSpace,
      lineHeight: lineHeightOf(node, charH),
      measureText: widthOf,
    });
    return { w: 16 + 6 + layout.width, h: Math.max(layout.height, 16) };
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
  if (node.tag === "img") {
    return { w: (node as any).imgWidth ?? 32, h: (node as any).imgHeight ?? 32 };
  }
  if (node.tag === "canvas") {
    // Canvas intrinsic size = its width/height attributes. Without this the
    // layout collapsed the node to 0x0 (no intrinsic size), so ui.drawCanvas
    // content drew into a 2x2 sliver and was invisible.
    return { w: (node as any).canvasW ?? 0, h: (node as any).canvasH ?? 0 };
  }
  if (node.tag === "list") {
    return { w: 0, h: 100 };  // lists default to 100px tall, expand via flex
  }
  // Containers have no intrinsic size in block layout — they fill available.
  return { w: 0, h: 0 };
}

/** Bind a set of font assets to measure(), returning a measureFn the layout
 *  engines accept. Text nodes using a custom @font-face then measure at the
 *  font's real glyph advances; nodes on the default font are unaffected. */
export function measureWithFonts(fontAssets: UIFontAssetModel[]): (node: StyledNode, availableWidth?: number) => IntrinsicSize {
  return (node, availableWidth) => measure(node, availableWidth, fontAssets);
}
