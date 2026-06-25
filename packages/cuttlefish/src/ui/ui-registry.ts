// ---------------------------------------------------------------------------
// UI module registry — cross-phase state for `.ui.html` modules.
//
// `.ui.html` is parsed once at resolution time (graph build), and its styled
// tree is stored here. Two later phases consume it independently:
//   - call lowering (ui.mount) → lowerOnMount() does final layout+lower using
//     the mount's viewport, and marks the entry file as having a UI.
//   - emit injection (cpp-emitter) → reads lowered tables + the entry-has-UI
//     flag to inject the runtime header + tables into the entry TU.
//
// Mirrors the module-scoped Map pattern of halInstances / halClassRegistry.
//
// Design choice: final layout is deferred to mount time because the viewport
// comes from ui.mount's display context, not from the .ui.html itself. So
// loadUIModule stores the styled tree; lowerOnMount produces the C++ tables.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { parseHtml, parseHtmlWithKeyboards, extractStyleBlocks } from "./html-parser.js";
import type { KeyboardTemplate } from "./html-parser.js";
import { getThemeCss } from "./theme-store.js";
import { loadImageAssets, UIImageAsset } from "./image-assets.js";
import { parseCss, parseFontFaces, parseKeyframes } from "./css-parser.js";
import type { CSSFontFace, CSSRule, KeyframeSet } from "./css-parser.js";
import { resolveStyles, StyledNode } from "./style-resolver.js";
import { resolveColor } from "./color.js";
import type { KeyframeSetModel } from "./model.js";
import { selectEngine } from "./select-engine.js";
import { measure, Box } from "./layout-engine.js";
import { lowerUIToCpp, LoweredUI } from "../ir/transformers/ui-lowering.js";
import { getDisplayProfile } from "./display-profile-store.js";
import { buildUIFontAssets } from "./font-assets.js";
import type { UIFontAssetModel } from "./font-assets.js";

export interface UIModule {
  /** Absolute path of the .ui.html source. */
  htmlPath: string;
  /** Resolved-style tree (HTML + CSS merged). Layout deferred to mount. */
  styled: StyledNode;
  /** All resolved <screen> trees (for multi-screen navigation). */
  allStyledScreens: StyledNode[];
  /** <keyboard> templates parsed from the same .ui.html (sibling declarations). */
  keyboards: KeyboardTemplate[];
  /** CSS rules from the sibling .ui.css (used for keyboard key styling). */
  rules: CSSRule[];
  /** @font-face rules from CSS, resolved into build-time font assets. */
  fontFaces: CSSFontFace[];
  fontAssets: UIFontAssetModel[];
  /** Raw @keyframes blocks parsed from CSS. */
  rawKeyframes: KeyframeSet[];
}

export interface LowerOptions {
  colorFormat: "rgb565" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
}

const modules = new Map<string, UIModule>();
const lowered = new Map<string, LoweredUI>();
let entryHasUIFlag = false;

/** Reset the registry. Called at the start of each transpile run. */
export function resetUIRegistry(): void {
  modules.clear();
  lowered.clear();
  entryHasUIFlag = false;
}

/** Load a `.ui.html` module: parse HTML + sibling `.ui.css`, resolve styles, cache. */
export function loadUIModule(htmlPath: string): UIModule {
  const abs = path.resolve(htmlPath);
  const cached = modules.get(abs);
  if (cached) return cached;

  if (!fs.existsSync(abs)) {
    throw new Error(`UI module not found: ${abs}`);
  }
  const htmlText = fs.readFileSync(abs, "utf-8");
  // CSS path: use theme override if set, else the default sibling .ui.css.
  const themeOverride = getThemeCss();
  const cssPath = themeOverride
    ? (path.isAbsolute(themeOverride) ? themeOverride : path.resolve(path.dirname(abs), themeOverride))
    : abs.replace(/\.ui\.html$/, ".ui.css");
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf-8") : "";

  const parsed = parseHtmlWithKeyboards(htmlText);
  const tree = parsed.tree;
  const allScreens = parsed.screens;
  const keyboards = parsed.keyboards;
  // Merge <style> blocks from the HTML with the external .ui.css.
  const styleBlocks = extractStyleBlocks(htmlText);
  const fullCss = cssText + "\n" + styleBlocks;
  const rules = parseCss(fullCss);
  const fontFaces = parseFontFaces(fullCss);
  const styled = resolveStyles(tree, rules);
  const allStyledScreens = allScreens.map(s => resolveStyles(s, rules));
  const fontRoot: StyledNode = { tag: "screen", classes: [], style: {}, children: allStyledScreens };
  const fontAssets = buildUIFontAssets(fontRoot, fontFaces, path.dirname(cssPath));

  const rawKeyframes = parseKeyframes(fullCss);
  const mod: UIModule = { htmlPath: abs, styled, allStyledScreens, keyboards, rules, fontFaces, fontAssets, rawKeyframes };
  modules.set(abs, mod);

  // Write a sibling .ui.html.d.ts so editors and the type-checker see the
  // imported `screen` symbol with precise per-id typing.
  writeTypeDeclSibling(abs, allStyledScreens);

  return mod;
}

/** Produce (or return cached) the lowered C++ tables for a module, using the mount viewport. */
export function lowerOnMount(htmlPath: string, opts: LowerOptions): LoweredUI {
  const abs = path.resolve(htmlPath);
  const cached = lowered.get(abs);
  if (cached) return cached;

  const mod = modules.get(abs);
  if (!mod) throw new Error(`Cannot lower unregistered UI module: ${abs}`);

  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };

  // Layout all screens (each gets its own Yoga layout pass; boxes concatenated).
  let allBoxes: Box[] = [];
  let allStyled: StyledNode[] = [];
  for (const screen of mod.allStyledScreens.length > 0 ? mod.allStyledScreens : [mod.styled]) {
    const engine = selectEngine(screen);
    const screenBoxes = engine.arrange(screen, viewport, measure);
    allBoxes = allBoxes.concat(screenBoxes);
    allStyled.push(screen);
  }

  // Load image assets from all screens (before lowering so imgDataId can be set).
  const htmlDir = path.dirname(abs);
  const imageAssets: UIImageAsset[] = [];
  for (const screen of allStyled.length > 0 ? allStyled : [mod.styled]) {
    const screenImages = loadImageAssets(screen, htmlDir);
    for (const img of screenImages) {
      if (!imageAssets.some(a => a.id === img.id)) imageAssets.push(img);
    }
  }
  // Build a map: node id → image index, for the model to assign imgDataId.
  const imageAssetIds = new Map<string, number>();
  imageAssets.forEach((a, i) => imageAssetIds.set(a.id, i));

  // Resolve @keyframes from the module's parsed keyframe sets.
  const keyframeSets: KeyframeSetModel[] = (mod.rawKeyframes || []).map(ks => ({
    name: ks.name,
    stops: ks.stops.map(s => ({
      percent: s.percent,
      bg: s.background ? resolveColor(s.background, opts.colorFormat) : 0,
      fg: s.color ? resolveColor(s.color, opts.colorFormat) : 0,
      opacity: s.opacity ? Math.max(0, Math.min(100, parseInt(s.opacity, 10) || 100)) : 100,
    })),
  }));

  const result = lowerUIToCpp(mod.styled, allBoxes, opts.colorFormat, opts.storage, mod.keyboards, mod.rules, getDisplayProfile(), mod.fontAssets, allStyled, imageAssetIds, keyframeSets);

  // Emit image tables.
  result.imageTables = emitImageTables(imageAssets);
  lowered.set(abs, result);
  return result;
}

/** Emit C++ image data arrays + index table from image assets. */
function emitImageTables(assets: UIImageAsset[]): string {
  if (assets.length === 0) {
    return "const UIImage __ui_images[] = {};\nconst uint8_t __ui_image_count = 0;";
  }
  const lines: string[] = [];
  // Emit one data array per image.
  for (const asset of assets) {
    lines.push(`static const uint16_t __ui_img_${asset.id}_data[] = {`);
    // Emit in rows of 16 values.
    for (let i = 0; i < asset.data.length; i += 16) {
      const chunk = asset.data.slice(i, i + 16).map(v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0"));
      lines.push("  " + chunk.join(", ") + ",");
    }
    lines.push(`};`);
  }
  // Emit the index table.
  lines.push(`const UIImage __ui_images[] = {`);
  for (const asset of assets) {
    lines.push(`  { ${asset.width}, ${asset.height}, __ui_img_${asset.id}_data },`);
  }
  lines.push(`};`);
  lines.push(`const uint8_t __ui_image_count = ${assets.length};`);
  return lines.join("\n");
}

export function getUIModule(htmlPath: string): UIModule | undefined {
  return modules.get(path.resolve(htmlPath));
}

export function getLoweredUIModule(htmlPath: string): LoweredUI | undefined {
  return lowered.get(path.resolve(htmlPath));
}

export function hasUIModule(htmlPath: string): boolean {
  return modules.has(path.resolve(htmlPath));
}

/** All loaded UI modules (used by the emitter to inject every mounted tree). */
export function allUIModules(): UIModule[] {
  return [...modules.values()];
}

/** All lowered UI modules (those whose ui.mount has been processed). */
export function allLoweredUIModules(): Array<{ htmlPath: string; lowered: LoweredUI }> {
  return [...lowered.entries()].map(([htmlPath, l]) => ({ htmlPath, lowered: l }));
}

// ── Entry-has-UI flag (gates runtime header + table injection) ──────────────

export function markEntryHasUI(): void {
  entryHasUIFlag = true;
}

export function entryHasUI(): boolean {
  return entryHasUIFlag;
}

export function clearEntryHasUI(): void {
  entryHasUIFlag = false;
}

// ── Type-declaration sibling (.ui.html.d.ts) ────────────────────────────────

function uiElementTypeForTag(tag: string): string {
  switch (tag) {
    case "button": return "ButtonElement";
    case "view":
    case "screen": return "ViewElement";
    case "check": return "CheckElement";
    case "select": return "SelectElement";
    case "radio": return "RadioElement";
    case "progress": return "ProgressElement";
    case "range": return "RangeElement";
    case "input": return "InputElement";
    default: return "TextElement";
  }
}

function writeTypeDeclSibling(htmlPath: string, styled: StyledNode | StyledNode[]): void {
  const dtsPath = htmlPath.replace(/\.ui\.html$/, ".ui.html.d.ts");
  const ids = new Map<string, string>();
  const collect = (n: StyledNode) => {
    if (n.id && !ids.has(n.id)) ids.set(n.id, n.tag);
    n.children.forEach(collect);
  };
  for (const root of Array.isArray(styled) ? styled : [styled]) collect(root);

  const fields = [...ids.entries()]
    .map(([id, tag]) => `  ${id}: ${uiElementTypeForTag(tag)};`)
    .join("\n");

  const dts = [
    `// Auto-generated by cuttlefish (UI lowering). Do not edit.`,
    `import type { TextElement, ButtonElement, ViewElement, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement } from "@typecad/ui";`,
    `export interface ScreenTree {`,
    fields,
    `}`,
    `export const screen: ScreenTree;`,
  ].join("\n");

  fs.writeFileSync(dtsPath, dts, "utf-8");
}
