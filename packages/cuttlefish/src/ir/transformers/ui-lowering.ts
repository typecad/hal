// ---------------------------------------------------------------------------
// UI lowering — styled tree + computed boxes → C++ node/binding/transition
// tables + a .ui.html.d.ts declaration file.
//
// This is the bridge between the host-side parse/layout pipeline and the
// device-side retained runtime. Colors are resolved to the target color format
// here (once, at transpile time) so the device never converts colors.
//
// Output shape:
//   - nodeTable:       `static const UINode __ui_nodes[] = { ... };`
//   - transitionTable: `static const UITransition __ui_trans[] = { ... };`
//   - typeDecl:        TypeScript declarations so .ui.html imports are typed.
// ---------------------------------------------------------------------------

import { StyledNode } from "../../ui/style-resolver.js";
import { Box } from "../../ui/layout-engine.js";
import { resolveColor } from "../../ui/color.js";
import { CSSProperty } from "../../ui/css-parser.js";

export interface LoweredUI {
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
}

type ColorFormat = "rgb565" | "mono";
type Storage = "progmem" | "flash";

interface FlatNode {
  index: number;
  tag: string;
  id?: string;
  text?: string;
  style: CSSProperty;
  box: Box;
  hasPressed: boolean;
  hasBg: boolean;
}

export function lowerUIToCpp(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  storage: Storage,
): LoweredUI {
  const flat: FlatNode[] = [];
  flatten(root, boxes, flat, { i: 0 });

  // Tables are mutable RAM (ui_tick updates bg/dirty/elapsed/active each
  // frame), so no PROGMEM/flash storage keyword — those imply read-only.
  const nodeTable = emitNodeTable(flat, colorFormat);
  const transitionTable = emitTransitionTable(flat, colorFormat);
  const typeDecl = emitTypeDecl(root);

  return { nodeTable, transitionTable, typeDecl };
}

function flatten(
  node: StyledNode,
  boxes: Box[],
  out: FlatNode[],
  cursor: { i: number },
): void {
  const index = cursor.i++;
  const box = boxes[index] ?? { x: 0, y: 0, w: 0, h: 0 };
  const hasPressed = !!(node.style as CSSProperty & { pressed?: CSSProperty }).pressed;
  const hasBg = !!node.style.background;
  out.push({
    index,
    tag: node.tag,
    id: node.id,
    text: node.text,
    style: node.style,
    box,
    hasPressed,
    hasBg,
  });
  for (const child of node.children) flatten(child, boxes, out, cursor);
}

function emitNodeTable(flat: FlatNode[], colorFormat: ColorFormat): string {
  const lines = flat.map((n) => {
    const kind = n.tag === "screen" || n.tag === "view" ? "NODE_FILL"
      : n.tag === "button" ? "NODE_BUTTON"
      : "NODE_TEXT";
    const bg = n.style.background ? resolveColor(n.style.background, colorFormat) : 0;
    const fg = n.style.color ? resolveColor(n.style.color, colorFormat) : 0xffff;
    const text = n.text ? `"${n.text}"` : "nullptr";
    const font = "nullptr";
    const box = `{${n.box.x},${n.box.y},${n.box.w},${n.box.h}}`;
    const bgStr = `0x${bg.toString(16).padStart(4, "0")}`;
    const fgStr = `0x${fg.toString(16).padStart(4, "0")}`;
    // text-align: 0=left, 1=center, 2=right
    const textAlign = n.style.textAlign === "center" ? 1 : n.style.textAlign === "right" ? 2 : 0;
    // border color: resolve if set
    const borderColor = n.style.borderColor ? resolveColor(n.style.borderColor, colorFormat) : 0;
    const borderColorStr = `0x${borderColor.toString(16).padStart(4, "0")}`;
    // border style: 0=none, 1=solid, 2=dashed
    const borderStyle = n.style.borderStyle === "solid" ? 1
      : n.style.borderStyle === "dashed" ? 2
      : n.style.borderStyle === "dotted" ? 2  // dotted approximated as dashed
      : n.style.border || n.style.borderWidth ? 1  // default to solid if border is set
      : 0;
    // underline: 1 if text-decoration: underline
    const underline = n.style.textDecoration === "underline" ? 1 : 0;
    // visibility: 0=hidden, 1=visible (default)
    const visible = n.style.visibility === "hidden" ? 0 : 1;
    return `  { .box=${box}, .bg=${bgStr}, .fg=${fgStr}, .kind=${kind}, .text=${text}, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${textAlign}, .borderColor=${borderColorStr}, .borderStyle=${borderStyle}, .underline=${underline}, .visible=${visible} },`;
  });
  return [
    // Mutable (not const) so ui_tick can update bg/dirty during transitions.
    // AVR would want PROGMEM + a shadow copy; ESP32-class has RAM to spare.
    `UINode __ui_nodes[] = {`,
    ...lines,
    `};`,
  ].join("\n");
}

function emitTransitionTable(flat: FlatNode[], colorFormat: ColorFormat): string {
  const entries: string[] = [];
  for (const n of flat) {
    if (!n.style.transition) continue;
    const prop = n.style.transition.property === "background" ? "PROP_BG" : "PROP_FG";
    // The :pressed state's target color for this property. On press,
    // ui_on_press arms the transition toward this value; on release,
    // ui_on_release arms it back toward the base value.
    const pressedStyle = (n.style as CSSProperty & { pressed?: CSSProperty }).pressed;
    const pressedBg = pressedStyle?.background
      ? resolveColor(pressedStyle.background, colorFormat)
      : n.style.background ? resolveColor(n.style.background, colorFormat) : 0;
    const baseBg = n.style.background ? resolveColor(n.style.background, colorFormat) : 0;
    const pressedHex = `0x${pressedBg.toString(16).padStart(4, "0")}`;
    const baseHex = `0x${baseBg.toString(16).padStart(4, "0")}`;
    entries.push(`  { .node=${n.index}, .prop=${prop}, .durationMs=${n.style.transition.durationMs}, .pressedTarget=${pressedHex}, .baseTarget=${baseHex} },`);
  }
  if (entries.length === 0) {
    return `const UITransition __ui_trans[] = {};`;
  }
  return [
    // Mutable: ui_tick updates elapsed/active each frame.
    `UITransition __ui_trans[] = {`,
    ...entries,
    `};`,
  ].join("\n");
}

function emitTypeDecl(root: StyledNode): string {
  // Collect id → tag pairs by walking the tree.
  const ids: Array<{ id: string; tag: string }> = [];
  const collect = (n: StyledNode) => {
    if (n.id) ids.push({ id: n.id, tag: n.tag });
    n.children.forEach(collect);
  };
  collect(root);

  const fields = ids.map(({ id, tag }) => {
    const typeName = tag.charAt(0).toUpperCase() + tag.slice(1);
    return `  ${id}: ${typeName}Element;`;
  }).join("\n");

  return [
    `// Auto-generated by cuttlefish UI lowering. Do not edit.`,
    `export interface ScreenTree {`,
    fields,
    `}`,
    ``,
    `export const screen: ScreenTree;`,
  ].join("\n");
}
