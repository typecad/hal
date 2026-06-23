import type { DisplayProfile } from "../api/shared/display-profile.js";
import { resolveColor } from "./color.js";
import type { CSSProperty } from "./css-parser.js";
import type { Box } from "./layout-engine.js";
import type { StyledNode } from "./style-resolver.js";

export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio";
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
}

function nodeKind(tag: string): UINodeKindModel {
  if (tag === "screen" || tag === "view") return "fill";
  if (tag === "button") return "button";
  if (tag === "check") return "check";
  if (tag === "radio") return "radio";
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
): void {
  const index = cursor.i++;
  const box = boxes[index] ?? { x: 0, y: 0, w: 0, h: 0 };
  const hasBg = !!node.style.background;
  const clearColor = hasBg ? node.style.background : parentBg;
  out.push({ index, node, box, hasBg, clearColor });

  const childParentBg = hasBg ? node.style.background : parentBg;
  for (const child of node.children) {
    flatten(child, boxes, out, cursor, childParentBg);
  }
}

export function lowerUIToModel(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  display?: DisplayProfile,
): UIProgram {
  const flat: FlatModelSource[] = [];
  flatten(root, boxes, flat, { i: 0 }, undefined);

  const nodes = flat.map(({ index, node, box, hasBg, clearColor }): UINodeModel => {
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
      textBuffer: "",
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
      value: 0,
      options: node.options,
    };
  });

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

