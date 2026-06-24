import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveColor } from "./color.js";
import type { CSSProperty } from "./css-parser.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { fontPxOf, normalizeFontFamily } from "./font-assets.js";
import type { Box } from "./layout-engine.js";
import type { StyledNode } from "./style-resolver.js";

export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio" | "progress" | "range" | "input";
export type UIPropertyModel = "background" | "color" | "text" | "visible" | "borderColor";

export interface UINodeModel {
  index: number;
  tag: string;
  id?: string;
  classes: string[];
  box: Box;
  bg: number;
  fg: number;
  kind: UINodeKindModel;
  text?: string;
  placeholder?: string;
  valueAttr?: string;
  name?: string;
  checked?: boolean;
  textBuffer: string;
  hasTextBinding: boolean;
  hasBg: boolean;
  textAlign: 0 | 1 | 2;
  textSize: number;       // GFX text size: 1-4 (from font-size + font-weight)
  fontAntialias: boolean; // true = smooth text edges when UI_AA is compiled
  fontFace: number;       // 0 = classic GFX bitmap font; otherwise UIFontAsset id
  borderColor: number;
  borderStyle: 0 | 1 | 2;
  borderRadius: number;  // px, 0=square
  underline: boolean;
  visible: boolean;
  opacity: number;       // 0-100
  clearColor: number;
  lastTextWidth: number;
  dirty: boolean;
  value: number;
  options?: Array<{ value: string; text: string }>;
  scrollable: boolean;
  scrollY: number;
  contentHeight: number;
  rangeMin: number;
  rangeMax: number;
  /** For <input>: max character length (0 = use UI_TEXT_BUF). */
  maxlen: number;
  /** For <input>: text or number keyboard. */
  inputType?: "text" | "number";
  /** For <input>: custom keyboard template id. */
  keyboard?: string;
  parentIndex: number;
  subtreeEnd: number;
}

export interface UITransitionModel {
  node: number;
  prop: "background" | "color";
  durationMs: number;
  pressedTarget: number;
  baseTarget: number;
  elapsed: number;
  prevValue: number;
  targetValue: number;
  active: boolean;
}

export interface UIProgram {
  width: number;
  height: number;
  colorFormat: "rgb565" | "mono";
  display?: DisplayProfile;
  fontAssets: UIFontAssetModel[];
  nodes: UINodeModel[];
  transitions: UITransitionModel[];
}

type ColorFormat = "rgb565" | "mono";

interface FlatModelSource {
  index: number;
  node: StyledNode;
  box: Box;
  hasBg: boolean;
  clearColor?: string;
  parentIndex: number;
  subtreeEnd: number;
}

function nodeKind(tag: string): UINodeKindModel {
  if (tag === "screen" || tag === "view") return "fill";
  if (tag === "button") return "button";
  if (tag === "check") return "check";
  if (tag === "radio") return "radio";
  if (tag === "progress") return "progress";
  if (tag === "range") return "range";
  if (tag === "input") return "input";
  return "text";
}

function textAlign(style: CSSProperty): 0 | 1 | 2 {
  if (style.textAlign === "center") return 1;
  if (style.textAlign === "right") return 2;
  return 0;
}

function borderStyle(style: CSSProperty): 0 | 1 | 2 {
  if (style.borderStyle === "solid") return 1;
  if (style.borderStyle === "dashed" || style.borderStyle === "dotted") return 2;
  if (style.borderStyle === "none") return 0;
  if (style.border || style.borderWidth) return 1;
  return 0;
}

/** Parse border-radius px value (0 if absent). */
function borderRadiusOf(style: CSSProperty): number {
  if (!style.borderRadius) return 0;
  const px = parseInt(style.borderRadius, 10);
  return isNaN(px) ? 0 : px;
}

/** Parse opacity (0-100, default 100). */
function opacityOf(style: CSSProperty): number {
  if (!style.opacity) return 100;
  const n = parseInt(style.opacity, 10);
  if (isNaN(n)) return 100;
  return Math.max(0, Math.min(100, n));
}

/** Map font-size (px) + font-weight to a GFX text size (1-4).
 *  ≤12px→1, 13-20px→2, 21-28px→3, 29+→4. Bold adds 1 (clamped to 4). */
function textSizeOf(style: CSSProperty): number {
  let size = 2;  // default
  if (style.fontSize) {
    const px = parseInt(style.fontSize, 10);
    if (!isNaN(px)) {
      if (px <= 12) size = 1;
      else if (px <= 20) size = 2;
      else if (px <= 28) size = 3;
      else size = 4;
    }
  }
  if (style.fontWeight === "bold" && size < 4) size++;
  return size;
}

function fontAntialiasOf(style: CSSProperty, display?: DisplayProfile): boolean {
  if (display?.colorFormat === "mono") return false;
  const smoothing = style.fontSmoothing?.toLowerCase();
  if (smoothing) {
    if (smoothing.includes("antialiased") || smoothing.includes("smooth") || smoothing.includes("grayscale")) {
      return true;
    }
    if (smoothing.includes("none") || smoothing.includes("aliased") || smoothing.includes("pixel")) {
      return false;
    }
  }
  return display?.antialias === true;
}

function fontFaceOf(style: CSSProperty, fontAssets: UIFontAssetModel[]): number {
  const family = normalizeFontFamily(style.fontFamily);
  if (!family) return 0;
  const px = fontPxOf(style);
  const match = fontAssets.find((asset) =>
    asset.family.toLowerCase() === family.toLowerCase() && asset.px === px);
  return match?.id ?? 0;
}

/** Apply text-transform (uppercase/lowercase/capitalize) to a static string. */
function applyTextTransform(text: string | undefined, style: CSSProperty): string | undefined {
  if (!text) return text;
  switch (style.textTransform) {
    case "uppercase": return text.toUpperCase();
    case "lowercase": return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return text;
  }
}

function flatten(
  node: StyledNode,
  boxes: Box[],
  out: FlatModelSource[],
  cursor: { i: number },
  parentBg: string | undefined,
  parentIndex: number = -1,
): void {
  const index = cursor.i++;
  const box = boxes[index] ?? { x: 0, y: 0, w: 0, h: 0 };
  const hasBg = !!node.style.background;
  const clearColor = hasBg ? node.style.background : parentBg;
  out.push({ index, node, box, hasBg, clearColor, parentIndex, subtreeEnd: index + 1 });

  const childParentBg = hasBg ? node.style.background : parentBg;
  for (const child of node.children) {
    flatten(child, boxes, out, cursor, childParentBg, index);
  }
  out[index].subtreeEnd = cursor.i;
}

export function lowerUIToModel(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  display?: DisplayProfile,
  fontAssets: UIFontAssetModel[] = [],
): UIProgram {
  const flat: FlatModelSource[] = [];
  flatten(root, boxes, flat, { i: 0 }, undefined);

  const nodes = flat.map(({ index, node, box, hasBg, clearColor, parentIndex, subtreeEnd }): UINodeModel => {
    const bg = node.style.background ? resolveColor(node.style.background, colorFormat) : 0;
    const fg = node.style.color ? resolveColor(node.style.color, colorFormat) : 0xffff;
    const bColor = node.style.borderColor ? resolveColor(node.style.borderColor, colorFormat) : 0;
    const clear = clearColor ? resolveColor(clearColor, colorFormat) : 0;

    return {
      index,
      tag: node.tag,
      id: node.id,
      classes: node.classes,
      box,
      bg,
      fg,
      kind: nodeKind(node.tag),
      text: applyTextTransform(node.text, node.style),
      placeholder: applyTextTransform(node.placeholder, node.style),
      valueAttr: node.value,
      name: node.name,
      checked: node.checked,
      textBuffer: applyTextTransform(node.placeholder, node.style) ?? "",
      hasTextBinding: false,
      hasBg,
      textAlign: textAlign(node.style),
      textSize: textSizeOf(node.style),
      fontAntialias: fontAntialiasOf(node.style, display),
      fontFace: fontFaceOf(node.style, fontAssets),
      borderColor: bColor,
      borderStyle: borderStyle(node.style),
      borderRadius: borderRadiusOf(node.style),
      underline: node.style.textDecoration === "underline",
      visible: node.style.visibility !== "hidden",
      opacity: opacityOf(node.style),
      clearColor: clear,
      lastTextWidth: 0,
      dirty: false,
      value: node.tag === "radio" && node.checked ? 1 : 0,
      options: node.options,
      scrollable: node.style.overflow === "scroll" || node.style.overflow === "hidden",
      scrollY: 0,
      contentHeight: 0, // computed after layout
      rangeMin: node.min ? (parseInt(node.min, 10) || 0) : 0,
      rangeMax: node.max ? (parseInt(node.max, 10) || 100) : 100,
      maxlen: node.maxlen ?? 0,
      inputType: node.type,
      keyboard: node.keyboard,
      parentIndex,
      subtreeEnd,
    };
  });

  // Compute contentHeight for scrollable nodes from actual tree descendants.
  for (let i = 0; i < flat.length; i++) {
    if (!nodes[i].scrollable) continue;
    const parentBox = nodes[i].box;
    let maxBottom = parentBox.y;
    for (let j = i + 1; j < nodes[i].subtreeEnd; j++) {
      const bottom = nodes[j].box.y + nodes[j].box.h;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    nodes[i].contentHeight = Math.max(parentBox.h, maxBottom - parentBox.y);
  }

  const transitions: UITransitionModel[] = [];
  for (const { index, node } of flat) {
    if (!node.style.transition) continue;
    const prop = node.style.transition.property === "background" ? "background" : "color";
    const pressedStyle = (node.style as CSSProperty & { pressed?: CSSProperty }).pressed;
    const pressedTarget = pressedStyle?.background
      ? resolveColor(pressedStyle.background, colorFormat)
      : node.style.background ? resolveColor(node.style.background, colorFormat) : 0;
    const baseTarget = node.style.background ? resolveColor(node.style.background, colorFormat) : 0;
    transitions.push({
      node: index,
      prop,
      durationMs: node.style.transition.durationMs,
      pressedTarget,
      baseTarget,
      elapsed: 0,
      prevValue: 0,
      targetValue: 0,
      active: false,
    });
  }

  return {
    width: display?.width ?? 0,
    height: display?.height ?? 0,
    colorFormat,
    display,
    fontAssets,
    nodes,
    transitions,
  };
}
