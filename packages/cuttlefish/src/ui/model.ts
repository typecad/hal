import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveColor } from "./color.js";
import type { CSSProperty } from "./css-parser.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { selectFontAssetForStyle } from "./font-assets.js";
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
  borderWidth: number;
  borderRadius: number;  // px, 0=square
  gradientEnabled: number;  // 0=none, 1=vertical, 2=horizontal
  gradientColor1: number;   // resolved RGB565 (top/left stop)
  gradientColor2: number;   // resolved RGB565 (bottom/right stop)
  outlineColor: number;
  outlineStyle: 0 | 1 | 2;
  outlineWidth: number;
  transformOffsetX: number;
  transformOffsetY: number;
  pressedOffsetX: number;
  pressedOffsetY: number;
  shadowCount: number;                    // 0-4 active shadows
  shadowOffsetX: number[];                // [4]
  shadowOffsetY: number[];
  shadowBlur: number[];
  shadowColor: number[];
  shadowAlpha: number[];
  shadowInset: boolean[];
  // Text shadow (single shadow for text elements)
  textShadowCount: number;        // 0-1
  textShadowOffsetX: number;
  textShadowOffsetY: number;
  textShadowBlur: number;
  textShadowColor: number;        // resolved RGB565
  textShadowAlpha: number;
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

function borderWidthOf(style: CSSProperty): number {
  const px = cssPx(style.borderWidth);
  if (px > 0) return Math.max(1, Math.min(8, px));
  return borderStyle(style) === 0 ? 0 : 1;
}

/** Parse border-radius px value (0 if absent). */
function borderRadiusOf(style: CSSProperty): number {
  if (!style.borderRadius) return 0;
  const px = parseInt(style.borderRadius, 10);
  return isNaN(px) ? 0 : px;
}

interface OutlineSpec { width: number; style: 0 | 1 | 2; color?: string; }
function outlineOf(style: CSSProperty): OutlineSpec {
  const raw = style.outline?.trim();
  if (!raw || raw === "none") return { width: 0, style: 0 };

  let width = 1;
  let outlineStyle: 0 | 1 | 2 = 1;
  let color: string | undefined;
  const parts = raw.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/^\d+(?:\.\d+)?(?:px)?$/.test(lower)) {
      width = Math.max(1, Math.min(8, cssPx(lower)));
    } else if (lower === "solid") {
      outlineStyle = 1;
    } else if (lower === "dashed" || lower === "dotted") {
      outlineStyle = 2;
    } else if (lower === "none") {
      return { width: 0, style: 0 };
    } else {
      color = part;
    }
  }

  return { width, style: outlineStyle, color };
}

function cssPx(value: string | undefined): number {
  if (!value) return 0;
  const m = /(-?\d+(?:\.\d+)?)/.exec(value);
  return m ? Math.round(Number(m[1])) : 0;
}

function clampInt8(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-128, Math.min(127, Math.round(n)));
}

function splitTransformArgs(args: string): string[] {
  return args
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function transformOffset(transform: string | undefined): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;
  const translateX = /translateX\(\s*([^)]+?)\s*\)/i.exec(transform);
  const translateY = /translateY\(\s*([^)]+?)\s*\)/i.exec(transform);
  if (translateX) x += cssPx(translateX[1]);
  if (translateY) y += cssPx(translateY[1]);

  const translate = /translate(?:3d)?\(\s*([^)]+?)\s*\)/i.exec(transform);
  if (translate) {
    const args = splitTransformArgs(translate[1]);
    if (args[0]) x += cssPx(args[0]);
    if (args[1]) y += cssPx(args[1]);
  }

  return { x, y };
}

function pressedOffsetOf(style: CSSProperty): { x: number; y: number } {
  const pressed = (style as CSSProperty & { pressed?: CSSProperty }).pressed;
  if (!pressed) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;
  if (pressed.left) x += cssPx(pressed.left) - cssPx(style.left);
  else if (pressed.right) x -= cssPx(pressed.right) - cssPx(style.right);
  if (pressed.top) y += cssPx(pressed.top) - cssPx(style.top);
  else if (pressed.bottom) y -= cssPx(pressed.bottom) - cssPx(style.bottom);

  if (pressed.transform) {
    const baseTransform = transformOffset(style.transform);
    const pressedTransform = transformOffset(pressed.transform);
    x += pressedTransform.x - baseTransform.x;
    y += pressedTransform.y - baseTransform.y;
  }

  return {
    x: clampInt8(x),
    y: clampInt8(y),
  };
}

/** Parse box-shadow into up to 4 shadow specs. Handles multi-shadow
 *  (comma-separated) and the `inset` keyword.
 *  Format per shadow: [inset] offsetX offsetY [blur] [spread] color. */
const MAX_SHADOWS = 4;
interface ShadowSpec { x: number; y: number; blur: number; color: number; alpha: number; inset: boolean; }
function parseBoxShadow(style: CSSProperty, format: "rgb565" | "mono"): ShadowSpec[] {
  const raw = style.boxShadow;
  if (!raw || raw === "none") return [];
  // Split on commas that are NOT inside parentheses (so rgba(0,0,0,0.5) isn't split).
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") depth--;
    else if (raw[i] === "," && depth === 0) { parts.push(raw.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(raw.slice(start).trim());

  const specs: ShadowSpec[] = [];
  for (const part of parts) {
    if (specs.length >= MAX_SHADOWS) break;
    const inset = /\binset\b/i.test(part);
    // Split into a numbers zone (offset/blur) and a color zone. The color
    // zone starts at the first # hex, rgb(, rgba(, or color name. css-tree
    // may strip spaces between values, so we can't rely on whitespace split.
    const colorStart = part.search(/#|rgba?\(|\b(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|cyan|magenta|silver|gold|brown|tan|navy|teal|maroon|lime|olive|aqua|fuchsia|transparent)\b/i);
    const numZone = colorStart >= 0 ? part.slice(0, colorStart) : part;
    const colorZone = colorStart >= 0 ? part.slice(colorStart) : "";

    // Extract numbers from the numeric zone only (safe — no hex digits here).
    const numTokens: number[] = [];
    const numRe = /(-?\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = numRe.exec(numZone)) !== null) numTokens.push(parseInt(m[1], 10));
    if (numTokens.length < 2) continue;
    const x = numTokens[0];
    const y = numTokens[1];
    const blur = numTokens.length >= 3 ? Math.max(0, Math.min(numTokens[2], 8)) : 0;

    // Resolve color from the color zone.
    let color = 0x0000;
    let alpha = 100;
    if (colorZone) {
      const alphaM = /rgba?\([^,]*,[^,]*,[^,]*,\s*([\d.]+)\s*\)/.exec(colorZone);
      if (alphaM) {
        alpha = Math.round(parseFloat(alphaM[1]) * 100);
        alpha = Math.max(0, Math.min(100, alpha));
      }
      try { color = resolveColor(colorZone, format); } catch { color = 0x0000; }
    }
    specs.push({ x, y, blur, color, alpha, inset });
  }
  return specs;
}

/** Parse opacity (0-100, default 100). */
function opacityOf(style: CSSProperty): number {
  if (!style.opacity) return 100;
  const n = parseInt(style.opacity, 10);
  if (isNaN(n)) return 100;
  return Math.max(0, Math.min(100, n));
}

/** Parse a linear-gradient background into 2 color stops + direction.
 *  Returns null for solid colors or unsupported gradients. */
interface GradientSpec { dir: 1 | 2; color1: number; color2: number; }

/** Extract the first color string from a linear-gradient(...) value.
 *  Used by flatten() to pass a valid color string as clearColor/parentBg. */
function extractFirstGradientColor(bg: string): string | undefined {
  const innerM = /linear-gradient\(\s*([^)]+)\)/.exec(bg);
  if (!innerM) return undefined;
  const colorRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+/gi;
  let cm: RegExpExecArray | null;
  while ((cm = colorRe.exec(innerM[1])) !== null) {
    if (!["to", "linear", "bottom", "top", "left", "right"].includes(cm[0])) return cm[0];
  }
  return undefined;
}

function parseGradient(bg: string | undefined, format: "rgb565" | "mono"): GradientSpec | null {
  if (!bg || !bg.includes("linear-gradient")) return null;
  // Extract the content inside linear-gradient(...).
  const innerM = /linear-gradient\(\s*([^)]+)\)/.exec(bg);
  if (!innerM) return null;
  const inner = innerM[1];
  // Extract color stops: match #hex, rgb(), rgba(), or named colors.
  const colorRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+/gi;
  const colors: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = colorRe.exec(inner)) !== null) {
    if (!["to", "linear", "bottom", "top", "left", "right"].includes(cm[0])) colors.push(cm[0]);
  }
  if (colors.length < 2) return null;
  // Direction: "to bottom" = vertical (1), "to right" = horizontal (2).
  // Default to vertical if not specified.
  let dir: 1 | 2 = 1;
  if (/to\s+right/i.test(inner) || /to\s+left/i.test(inner)) dir = 2;
  return {
    dir,
    color1: resolveColor(colors[0], format),
    color2: resolveColor(colors[1], format),
  };
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
  const match = selectFontAssetForStyle(fontAssets, style);
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
  // If background is a gradient, extract the first color stop as the base
  // clearColor string (avoids resolveColor choking on "linear-gradient(...)").
  const bgStr = node.style.background;
  const bgIsGradient = bgStr && bgStr.includes("linear-gradient");
  const bgBaseColor = bgIsGradient ? extractFirstGradientColor(bgStr!) : bgStr;
  const clearColor = hasBg ? bgBaseColor : parentBg;
  out.push({ index, node, box, hasBg, clearColor, parentIndex, subtreeEnd: index + 1 });

  const childParentBg = hasBg ? bgBaseColor : parentBg;
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
    // If background is a gradient, use the first stop as the base bg color
    // (the runtime draws the actual gradient per-row on top of this).
    const grad = parseGradient(node.style.background, colorFormat);
    const bg = node.style.background
      ? (grad ? grad.color1 : resolveColor(node.style.background, colorFormat))
      : 0;
    const fg = node.style.color ? resolveColor(node.style.color, colorFormat) : 0xffff;
    const bColor = node.style.borderColor ? resolveColor(node.style.borderColor, colorFormat) : 0;
    const clear = clearColor ? resolveColor(clearColor, colorFormat) : 0;
    const outline = outlineOf(node.style);
    const outlineColor = outline.color ? resolveColor(outline.color, colorFormat) : fg;
    const baseTransformOffset = transformOffset(node.style.transform);
    const pressedOffset = pressedOffsetOf(node.style);

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
      borderWidth: borderWidthOf(node.style),
      borderRadius: borderRadiusOf(node.style),
      outlineColor,
      outlineStyle: outline.style,
      outlineWidth: outline.width,
      transformOffsetX: clampInt8(baseTransformOffset.x),
      transformOffsetY: clampInt8(baseTransformOffset.y),
      pressedOffsetX: pressedOffset.x,
      pressedOffsetY: pressedOffset.y,
      // Background gradient (if background is a linear-gradient).
      ...(() => {
        const grad = parseGradient(node.style.background, colorFormat);
        return grad
          ? { gradientEnabled: grad.dir, gradientColor1: grad.color1, gradientColor2: grad.color2 }
          : { gradientEnabled: 0, gradientColor1: 0, gradientColor2: 0 };
      })(),
      ...(() => {
        const shadows = parseBoxShadow(node.style, colorFormat);
        const pad = <T>(arr: T[], val: T, n: number): T[] => {
          const out = [...arr];
          while (out.length < n) out.push(val);
          return out.slice(0, n);
        };
        return {
          shadowCount: shadows.length,
          shadowOffsetX: pad(shadows.map(s => s.x), 0, MAX_SHADOWS),
          shadowOffsetY: pad(shadows.map(s => s.y), 0, MAX_SHADOWS),
          shadowBlur: pad(shadows.map(s => s.blur), 0, MAX_SHADOWS),
          shadowColor: pad(shadows.map(s => s.color), 0, MAX_SHADOWS),
          shadowAlpha: pad(shadows.map(s => s.alpha), 0, MAX_SHADOWS),
          shadowInset: pad(shadows.map(s => s.inset), false, MAX_SHADOWS),
        };
      })(),
      // Text shadow: reuse parseBoxShadow for the text-shadow value.
      ...(() => {
        const tsShadows = parseBoxShadow({ boxShadow: node.style.textShadow } as CSSProperty, colorFormat);
        const ts = tsShadows[0];
        return ts
          ? { textShadowCount: 1, textShadowOffsetX: ts.x, textShadowOffsetY: ts.y, textShadowBlur: ts.blur, textShadowColor: ts.color, textShadowAlpha: ts.alpha }
          : { textShadowCount: 0, textShadowOffsetX: 0, textShadowOffsetY: 0, textShadowBlur: 0, textShadowColor: 0, textShadowAlpha: 0 };
      })(),
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
    const pressedTarget = prop === "background"
      ? pressedStyle?.background
        ? resolveColor(pressedStyle.background, colorFormat)
        : node.style.background ? resolveColor(node.style.background, colorFormat) : 0
      : pressedStyle?.color
        ? resolveColor(pressedStyle.color, colorFormat)
        : node.style.color ? resolveColor(node.style.color, colorFormat) : 0xffff;
    const baseTarget = prop === "background"
      ? node.style.background ? resolveColor(node.style.background, colorFormat) : 0
      : node.style.color ? resolveColor(node.style.color, colorFormat) : 0xffff;
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
