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
import { lowerUIToModel, UIProgram, UINodeModel } from "../../ui/model.js";
import { resolveColor } from "../../ui/color.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../../ui/default-keyboards.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../../ui/html-parser.js";
import type { CSSRule, CSSProperty } from "../../ui/css-parser.js";

export interface LoweredUI {
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
  /** C++ keyboard loader function bodies (one per keyboard in use). */
  keyboardLoaders: string;
  /** C++ dispatch table mapping input node index → loader function. */
  keyboardDispatch: string;
}

type ColorFormat = "rgb565" | "mono";
type Storage = "progmem" | "flash";

export function lowerUIToCpp(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  storage: Storage,
  keyboards: KeyboardTemplate[] = [],
  rules: CSSRule[] = [],
): LoweredUI {
  void storage;
  const model = lowerUIToModel(root, boxes, colorFormat);

  // Tables are mutable RAM (ui_tick updates bg/dirty/elapsed/active each
  // frame), so no PROGMEM/flash storage keyword — those imply read-only.
  const nodeTable = emitNodeTable(model);
  const transitionTable = emitTransitionTable(model);
  const typeDecl = emitTypeDecl(root);

  // Keyboard loaders + dispatch: collect input nodes in tree order, resolve
  // each to its loader (default by type, or a referenced <keyboard>).
  const inputSpecs: Array<{ type?: string; keyboard?: string }> = [];
  const collectInputs = (n: StyledNode) => {
    if (n.tag === "input") inputSpecs.push({ type: n.type, keyboard: n.keyboard });
    n.children.forEach(collectInputs);
  };
  collectInputs(root);

  const neededKeyboards: KeyboardTemplate[] = [];
  const addIfNeeded = (kb: KeyboardTemplate) => {
    if (!neededKeyboards.some(k => k.id === kb.id)) neededKeyboards.push(kb);
  };
  for (const spec of inputSpecs) {
    if (spec.keyboard) {
      const match = keyboards.find(k => k.id === spec.keyboard);
      if (match) addIfNeeded(match);
    } else {
      addIfNeeded(spec.type === "number" ? DEFAULT_NUMBER_KEYBOARD : DEFAULT_ALPHA_KEYBOARD);
    }
  }

  const keyboardLoaders = neededKeyboards
    .map(kb => emitKeyboardLoader(loaderNameForId(kb.id), kb, rules, colorFormat))
    .join("\n\n");

  const dispatchEntries = inputSpecs.map(spec => loaderNameForInput(spec, keyboards));
  const keyboardDispatch = dispatchEntries.length > 0
    ? `void (*__ui_kb_loaders[])() = { ${dispatchEntries.join(", ")} };\nconst uint8_t __ui_kb_loader_count = ${dispatchEntries.length};`
    : `void (*__ui_kb_loaders[])() = {};\nconst uint8_t __ui_kb_loader_count = 0;`;

  return { nodeTable, transitionTable, typeDecl, keyboardLoaders, keyboardDispatch };
}

function sanitizedId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function loaderNameForId(id: string): string {
  return `__ui_kb_load_${sanitizedId(id)}`;
}

function loaderNameForInput(input: { type?: string; keyboard?: string }, keyboards: KeyboardTemplate[]): string {
  if (input.keyboard) {
    const match = keyboards.find(k => k.id === input.keyboard);
    if (match) return loaderNameForId(match.id);
  }
  return input.type === "number" ? "__ui_kb_load_default_number" : "__ui_kb_load_default_alpha";
}

// Default key colors (fallback when no CSS matches). Used for all keys.
const DEFAULT_KEY_BG = 0x4208;    // dark gray
const DEFAULT_KEY_FG = 0xFFFF;    // white
const DEFAULT_KEY_BORDER = 0xFFFF; // white
const DEFAULT_KB_BG = 0x0000;     // black

/** Resolve a key's CSS classes into a merged CSSProperty (cascade: last wins). */
function resolveKeyStyle(keyClasses: string[] | undefined, kbClasses: string[] | undefined, rules: CSSRule[]): CSSProperty {
  const merged: CSSProperty = {};
  const allClasses = [...(kbClasses ?? []), ...(keyClasses ?? [])];
  for (const rule of rules) {
    if (rule.selector.kind === "class" && allClasses.includes(rule.selector.name)) {
      Object.assign(merged, rule.properties);
    }
  }
  return merged;
}

/** Resolve the keyboard-level background from CSS (keyboard classes). */
function resolveKbBg(kbClasses: string[] | undefined, rules: CSSRule[], colorFormat: ColorFormat): number {
  const merged: CSSProperty = {};
  for (const rule of rules) {
    if (rule.selector.kind === "class" && (kbClasses ?? []).includes(rule.selector.name)) {
      Object.assign(merged, rule.properties);
    }
  }
  return merged.background ? resolveColor(merged.background, colorFormat) : DEFAULT_KB_BG;
}

function emitKeyboardLoader(name: string, kb: KeyboardTemplate, rules: CSSRule[], colorFormat: ColorFormat): string {
  const rows = kb.rows;
  const cols = rows.length > 0 ? Math.max(...rows.map(r => r.length)) : 0;
  const kbBg = resolveKbBg(kb.classes, rules, colorFormat);
  const lines: string[] = [];
  lines.push(`void ${name}() {`);
  lines.push(`  __ui_kb_rows = ${rows.length};`);
  lines.push(`  __ui_kb_cols = ${cols};`);
  lines.push(`  __ui_kb_keyCount = 0;`);
  lines.push(`  __ui_kb_bg = ${hex(kbBg)};`);
  for (const row of rows) {
    for (const key of row) {
      lines.push(`  ${emitKeyLine(key, kb.classes, rules, colorFormat)}`);
    }
    // Pad short rows so ui_kb_key_rect's idx/cols math stays aligned. Padded
    // cells use special=255 (skipped in draw + hit-test) with a space char.
    for (let p = row.length; p < cols; p++) {
      lines.push(`  __ui_kb_keys[__ui_kb_keyCount] = { ' ', 255 };`);
      lines.push(`  __ui_kb_styles[__ui_kb_keyCount] = { ${hex(DEFAULT_KEY_BG)}, ${hex(DEFAULT_KEY_FG)}, ${hex(DEFAULT_KEY_BORDER)} };`);
      lines.push(`  __ui_kb_keyCount++;`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

/** Emit one key's keys[] + styles[] lines, resolving CSS classes to colors. */
function emitKeyLine(key: UIKeyTemplate, kbClasses: string[] | undefined, rules: CSSRule[], colorFormat: ColorFormat): string {
  const chEsc = key.ch === "\\" ? "\\\\" : key.ch === "'" ? "\\'" : key.ch;
  const style = resolveKeyStyle(key.classes, kbClasses, rules);
  const bg = style.background ? resolveColor(style.background, colorFormat) : DEFAULT_KEY_BG;
  const fg = style.color ? resolveColor(style.color, colorFormat) : DEFAULT_KEY_FG;
  const border = style.borderColor ? resolveColor(style.borderColor, colorFormat) : DEFAULT_KEY_BORDER;
  return [
    `__ui_kb_keys[__ui_kb_keyCount] = { '${chEsc}', ${key.special} };`,
    `  __ui_kb_styles[__ui_kb_keyCount] = { ${hex(bg)}, ${hex(fg)}, ${hex(border)} };`,
    `  __ui_kb_keyCount++;`,
  ].join(" ");
}

function cppKind(kind: UINodeModel["kind"]): string {
  switch (kind) {
    case "fill": return "NODE_FILL";
    case "button": return "NODE_BUTTON";
    case "check": return "NODE_CHECK";
    case "radio": return "NODE_RADIO";
    case "progress": return "NODE_PROGRESS";
    case "range": return "NODE_RANGE";
    case "input": return "NODE_INPUT";
    case "text": return "NODE_TEXT";
  }
}

function hex(c: number): string {
  return `0x${c.toString(16).padStart(4, "0")}`;
}

function emitNodeTable(model: UIProgram): string {
  const lines = model.nodes.map((n) => {
    const text = n.text ? `"${n.text}"` : "nullptr";
    const font = "nullptr";
    // Input nodes seed textBuffer with the placeholder so it shows before editing.
    // (A string literal initializes the char array + null-terminates automatically.)
    const textBufInit = n.kind === "input" && n.textBuffer
      ? `"${n.textBuffer}"`
      : "{0}";
    const box = `{${n.box.x},${n.box.y},${n.box.w},${n.box.h}}`;
    const parent = n.parentIndex >= 0 ? n.parentIndex : 255;
    // Progress/range use lastTextWidth as a "previous fill width" for
    // incremental redraw. -1 = never drawn, because fill width 0 is valid.
    const lastTextWidth = n.kind === "progress" || n.kind === "range" ? -1 : 0;
    return `  { .box=${box}, .bg=${hex(n.bg)}, .fg=${hex(n.fg)}, .kind=${cppKind(n.kind)}, .text=${text}, .textBuffer=${textBufInit}, .hasTextBinding=0, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${n.textAlign}, .borderColor=${hex(n.borderColor)}, .borderStyle=${n.borderStyle}, .underline=${n.underline ? 1 : 0}, .visible=${n.visible ? 1 : 0}, .clearColor=${hex(n.clearColor)}, .lastTextWidth=${lastTextWidth}, .scrollable=${n.scrollable ? 1 : 0}, .scrollY=0, .contentHeight=${n.contentHeight}, .parent=${parent}, .subtreeEnd=${n.subtreeEnd}, .rangeMin=${n.rangeMin}, .rangeMax=${n.rangeMax}, .maxlen=${n.maxlen}, .dirty=0, .value=${n.checked ? 1 : 0} },`;
  });
  return [
    // Mutable (not const) so ui_tick can update bg/dirty during transitions.
    // AVR would want PROGMEM + a shadow copy; ESP32-class has RAM to spare.
    `UINode __ui_nodes[] = {`,
    ...lines,
    `};`,
  ].join("\n");
}

function emitTransitionTable(model: UIProgram): string {
  const entries = model.transitions.map((t) => {
    const prop = t.prop === "background" ? "PROP_BG" : "PROP_FG";
    return `  { .node=${t.node}, .prop=${prop}, .durationMs=${t.durationMs}, .pressedTarget=${hex(t.pressedTarget)}, .baseTarget=${hex(t.baseTarget)} },`;
  });
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
