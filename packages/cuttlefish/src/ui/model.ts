import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveColor } from "./color.js";
import type { CSSProperty } from "./css-parser.js";
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
  valueAttr?: string;
  name?: string;
  checked?: boolean;
  textBuffer: string;
  hasTextBinding: boolean;
  hasBg: boolean;
  textAlign: 0 | 1 | 2;
  borderColor: number;
  borderStyle: 0 | 1 | 2;
  underline: boolean;
  visible: boolean;
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
      text: node.text,
      valueAttr: node.value,
      name: node.name,
      checked: node.checked,
      textBuffer: node.placeholder ?? "",
      hasTextBinding: false,
      hasBg,
      textAlign: textAlign(node.style),
      borderColor: bColor,
      borderStyle: borderStyle(node.style),
      underline: node.style.textDecoration === "underline",
      visible: node.style.visibility !== "hidden",
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
    nodes,
    transitions,
  };
}
