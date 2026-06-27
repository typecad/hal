// ---------------------------------------------------------------------------
// UI lowering — styled tree + computed boxes → C++ node/binding/transition
// tables + a .ui.d.html.ts declaration file.
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
import { lowerUIToModel, UIProgram, UINodeModel, KeyframeSetModel } from "../../ui/model.js";
import { resolveColor } from "../../ui/color.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../../ui/default-keyboards.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../../ui/html-parser.js";
import type { CSSRule, CSSProperty } from "../../ui/css-parser.js";
import type { DisplayProfile } from "../../api/shared/display-profile.js";
import type { UIFontAssetModel } from "../../ui/font-assets.js";

export interface LoweredUI {
  fontTables: string;
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
  /** C++ keyboard loader function bodies (one per keyboard in use). */
  keyboardLoaders: string;
  /** C++ dispatch table mapping input node index → loader function. */
  keyboardDispatch: string;
  /** Number of distinct screens (for multi-screen navigation). */
  screenCount: number;
  /** C++ image data arrays + index table (for <img> support). */
  imageTables: string;
  /** C++ keyframe data arrays + animation table. */
  keyframeTables: string;
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
  display?: DisplayProfile,
  fontAssets: UIFontAssetModel[] = [],
  allScreens: StyledNode[] = [],
  imageAssetIds: Map<string, number> = new Map(),
  keyframeSets: KeyframeSetModel[] = [],
): LoweredUI {
  void storage;
  const model = lowerUIToModel(root, boxes, colorFormat, display, fontAssets, allScreens, imageAssetIds, keyframeSets);

  // Tables are mutable RAM (ui_tick updates bg/dirty/elapsed/active each
  // frame), so no PROGMEM/flash storage keyword — those imply read-only.
  const fontTables = emitFontTables(model);
  const nodeTable = emitNodeTable(model);
  const transitionTable = emitTransitionTable(model);
  const typeDecl = emitTypeDecl(root);

  // Keyboard loaders + dispatch: collect input nodes in tree order, resolve
  // each to its loader (default by type, or a referenced <keyboard>).
  // Walk ALL screens (inputs may live on any screen, not just the root).
  const inputSpecs: Array<{ type?: string; keyboard?: string }> = [];
  const collectInputs = (n: StyledNode) => {
    if (n.tag === "input") inputSpecs.push({ type: n.type, keyboard: n.keyboard });
    n.children.forEach(collectInputs);
  };
  const inputRoots = allScreens.length > 0 ? allScreens : [root];
  for (const sr of inputRoots) collectInputs(sr);

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

  const screenCount = model.nodes.length > 0 ? Math.max(...model.nodes.map(n => n.screenId)) + 1 : 1;
  const imageTables = "const UIImage __ui_images[] = {};\nconst uint8_t __ui_image_count = 0;";
  const keyframeTables = emitKeyframeTables(model);
  return { fontTables, nodeTable, transitionTable, typeDecl, keyboardLoaders, keyboardDispatch, screenCount, imageTables, keyframeTables };
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
/** Check if a CSS rule's selector matches any of the given class names.
 *  Only matches single-compound class selectors (no descendant for keys). */
function ruleMatchesClass(rule: CSSRule, classes: string[]): boolean {
  // Must be a single compound (no descendant combinator).
  if (rule.selector.compounds.length !== 1) return false;
  const compound = rule.selector.compounds[0];
  // Every simple in the compound must be a class that's in the list.
  for (const s of compound) {
    if (s.kind !== "class" || !classes.includes(s.name)) return false;
  }
  return true;
}

function resolveKeyStyle(keyClasses: string[] | undefined, kbClasses: string[] | undefined, rules: CSSRule[]): CSSProperty {
  const merged: CSSProperty = {};
  const allClasses = [...(kbClasses ?? []), ...(keyClasses ?? [])];
  for (const rule of rules) {
    if (ruleMatchesClass(rule, allClasses)) {
      Object.assign(merged, rule.properties);
    }
  }
  return merged;
}

/** Resolve the keyboard-level background from CSS (keyboard classes). */
function resolveKbBg(kbClasses: string[] | undefined, rules: CSSRule[], colorFormat: ColorFormat): number {
  const merged: CSSProperty = {};
  const classes = kbClasses ?? [];
  for (const rule of rules) {
    if (ruleMatchesClass(rule, classes)) {
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
      lines.push(`  ui_kb_add_key(' ', 255, ${hex(DEFAULT_KEY_BG)}, ${hex(DEFAULT_KEY_FG)}, ${hex(DEFAULT_KEY_BORDER)});`);
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
  return `ui_kb_add_key('${chEsc}', ${key.special}, ${hex(bg)}, ${hex(fg)}, ${hex(border)});`;
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
    case "img": return "NODE_IMG";
    case "list": return "NODE_LIST";
    case "text": return "NODE_TEXT";
  }
}

function hex(c: number): string {
  return `0x${c.toString(16).padStart(4, "0")}`;
}

function cppString(value: string | undefined): string {
  return value ? JSON.stringify(value) : "nullptr";
}

function byteArray(values: number[]): string {
  if (values.length === 0) return "";
  const chunks: string[] = [];
  for (let i = 0; i < values.length; i += 16) {
    chunks.push("  " + values.slice(i, i + 16).map((v) => `0x${(v & 0xff).toString(16).padStart(2, "0")}`).join(", "));
  }
  return chunks.join(",\n");
}

function emitFontTables(model: UIProgram): string {
   const assets = model.fontAssets ?? [];
   if (assets.length === 0) {
     return [
       `const UIFontFace __ui_font_faces[] = {};`,
       `const uint8_t __ui_font_face_count = 0;`,
     ].join("\n");
   }

   const lines: string[] = [];
   for (const asset of assets) {
     lines.push(`// Font ${asset.id}: ${asset.family} ${asset.px}px ${asset.fontWeight} ${asset.fontStyle} ${asset.subset}`);
     // Alpha data goes in PROGMEM (constants in flash, not RAM) - accessed via pgm_read_byte on AVR
     lines.push(`static const uint8_t __ui_font_${asset.id}_alpha[] PROGMEM = {`);
     lines.push(byteArray(asset.alpha));
     lines.push(`};`);
     lines.push(`static const UIFontGlyph __ui_font_${asset.id}_glyphs[] = {`);
     for (const glyph of asset.glyphs) {
       lines.push(
         `  { ${glyph.codepoint}, ${glyph.xOffset}, ${glyph.yOffset}, ${glyph.width}, ${glyph.height}, ${glyph.advance}, ${glyph.dataOffset} },`,
       );
     }
     lines.push(`};`);
   }

   // Font faces and glyphs stay in regular memory for direct struct access
   // (AVR optimized builds can move the whole table to PROGMEM + accessor functions)
   lines.push(`const UIFontFace __ui_font_faces[] = {`);
   for (const asset of assets) {
     lines.push(
       `  { ${asset.id}, ${asset.glyphs.length}, ${asset.lineHeight}, ${asset.baseline}, __ui_font_${asset.id}_glyphs, __ui_font_${asset.id}_alpha },`,
     );
   }
   lines.push(`};`);
   lines.push(`const uint8_t __ui_font_face_count = ${assets.length};`);
   return lines.join("\n");
 }

function emitNodeTable(model: UIProgram): string {
  const lines = model.nodes.map((n) => {
    const text = cppString(n.text);
    const font = "nullptr";
    // Input nodes store the placeholder in .text (static literal) so the draw
    // can show it grayed when textBuffer is empty. textBuffer stays {0} so
    // ui_kb_open starts with a clean edit buffer (no placeholder to delete).
    const inputText = n.kind === "input" && n.textBuffer ? cppString(n.textBuffer) : text;
    const box = `{${n.box.x},${n.box.y},${n.box.w},${n.box.h}}`;
    const parent = n.parentIndex >= 0 ? n.parentIndex : 255;
    // Progress/range use lastTextWidth as a "previous fill width" for
    // incremental redraw. -1 = never drawn, because fill width 0 is valid.
    const lastTextWidth = n.kind === "progress" || n.kind === "range" ? -1 : 0;
    const shArr = (vals: number[], n = 4) => `{${[...vals.slice(0, n), ...Array(n - Math.min(vals.length, n)).fill(0)].join(",")}}`;
    return `  { .box=${box}, .bg=${hex(n.bg)}, .fg=${hex(n.fg)}, .kind=${cppKind(n.kind)}, .text=${inputText}, .textBuffer={0}, .hasTextBinding=0, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${n.textAlign}, .textSize=${n.textSize}, .lineHeight=${n.lineHeight}, .letterSpacing=${n.letterSpacing}, .fontAntialias=${n.fontAntialias ? 1 : 0}, .fontFace=${n.fontFace}, .borderColor=${hex(n.borderColor)}, .borderStyle=${n.borderStyle}, .borderWidth=${n.borderWidth}, .borderRadius=${n.borderRadius}, .gradientEnabled=${n.gradientEnabled}, .gradientColor1=${hex(n.gradientColor1)}, .gradientColor2=${hex(n.gradientColor2)}, .outlineColor=${hex(n.outlineColor)}, .outlineStyle=${n.outlineStyle}, .outlineWidth=${n.outlineWidth}, .zIndex=${n.zIndex}, .transformOffsetX=${n.transformOffsetX}, .transformOffsetY=${n.transformOffsetY}, .rotateDeg=${n.rotateDeg}, .pressedOffsetX=${n.pressedOffsetX}, .pressedOffsetY=${n.pressedOffsetY}, .shadowCount=${n.shadowCount}, .shadowOffsetX=${shArr(n.shadowOffsetX)}, .shadowOffsetY=${shArr(n.shadowOffsetY)}, .shadowBlur=${shArr(n.shadowBlur)}, .shadowColor={${n.shadowColor.slice(0, 4).map(hex).join(",")}}, .shadowAlpha=${shArr(n.shadowAlpha)}, .shadowInset=${shArr(n.shadowInset.map(v => v ? 1 : 0))}, .textShadowCount=${n.textShadowCount}, .textShadowOffsetX=${n.textShadowOffsetX}, .textShadowOffsetY=${n.textShadowOffsetY}, .textShadowBlur=${n.textShadowBlur}, .textShadowColor=${hex(n.textShadowColor)}, .textShadowAlpha=${n.textShadowAlpha}, .underline=${n.underline}, .textOverflow=${n.textOverflow ? 1 : 0}, .nowrap=${n.nowrap ? 1 : 0}, .whiteSpaceMode=${n.whiteSpaceMode}, .visible=${n.visible ? 1 : 0}, .opacity=${n.opacity}, .clearColor=${hex(n.clearColor)}, .lastTextWidth=${lastTextWidth}, .lastTextHeight=0, .scrollable=${n.scrollable ? 1 : 0}, .scrollY=0, .contentHeight=${n.contentHeight}, .parent=${parent}, .subtreeEnd=${n.subtreeEnd}, .screenId=${n.screenId}, .imgDataId=${n.imgDataId ?? 255}, .objectFit=${n.objectFit ?? 1}, .listItemHeight=${(n as any).listItemHeight ?? 0}, .rangeMin=${n.rangeMin}, .rangeMax=${n.rangeMax}, .maxlen=${n.maxlen}, .dirty=0, .value=${n.checked ? 1 : 0} },`;
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
    return `UITransition __ui_trans[] = {};`;
  }
  return [
    `UITransition __ui_trans[] = {`,
    ...entries,
    `};`,
  ].join("\n");
}

/** Emit keyframe stop arrays + keyframe set index + animation table. */
function emitKeyframeTables(model: UIProgram): string {
  if (model.keyframeSets.length === 0 && model.animations.length === 0) {
    return [
      `const UIKeyframeSet __ui_keyframe_sets[] = {};`,
      `const uint8_t __ui_keyframe_set_count = 0;`,
      `UIAnimation __ui_anims[] = {};`,
      `const uint8_t __ui_anim_count = 0;`,
    ].join("\n");
  }
  const lines: string[] = [];
  // Emit one stop array per keyframe set.
  for (const ks of model.keyframeSets) {
    const safeName = ks.name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`static const UIKeyframeStop __ui_kf_${safeName}_stops[] = {`);
    for (const s of ks.stops) {
      lines.push(`  { .percent=${s.percent}, .props=${s.props}, .bg=${hex(s.bg)}, .fg=${hex(s.fg)}, .opacity=${s.opacity}, .transformOffsetX=${s.transformOffsetX}, .transformOffsetY=${s.transformOffsetY}, .translatePctX=${s.translatePctX}, .translatePctY=${s.translatePctY}, .scaleX=${s.scaleX}, .scaleY=${s.scaleY}, .rotateDeg=${s.rotateDeg}, .width=${s.width}, .height=${s.height} },`);
    }
    lines.push(`};`);
  }
  // Emit keyframe set index table.
  lines.push(`const UIKeyframeSet __ui_keyframe_sets[] = {`);
  model.keyframeSets.forEach((ks) => {
    const safeName = ks.name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`  { .stopCount=${ks.stops.length}, .stops=__ui_kf_${safeName}_stops },`);
  });
  lines.push(`};`);
  lines.push(`const uint8_t __ui_keyframe_set_count = ${model.keyframeSets.length};`);
  // Emit animation table (mutable — runtime advances elapsed/active).
  lines.push(`UIAnimation __ui_anims[] = {`);
  for (const a of model.animations) {
    lines.push(`  { .node=${a.node}, .keyframeSet=${a.keyframeSet}, .durationMs=${a.durationMs}, .delayMs=${a.delayMs}, .iterations=${a.iterations}, .baseWidth=${a.baseWidth}, .baseHeight=${a.baseHeight}, .originX=${a.originX}, .originY=${a.originY}, .elapsed=0, .active=1, .lastUpdateMs=0 },`);
  }
  lines.push(`};`);
  lines.push(`const uint8_t __ui_anim_count = ${model.animations.length};`);
  return lines.join("\n");
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
