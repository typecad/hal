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
import { parseCss, parseFontFaces } from "./css-parser.js";
import type { CSSFontFace, CSSRule } from "./css-parser.js";
import { resolveStyles, StyledNode } from "./style-resolver.js";
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
  const fontAssets = buildUIFontAssets(styled, fontFaces, path.dirname(cssPath));

  const mod: UIModule = { htmlPath: abs, styled, allStyledScreens, keyboards, rules, fontFaces, fontAssets };
  modules.set(abs, mod);

  // Write a sibling .ui.html.d.ts so editors and the type-checker see the
  // imported `screen` symbol with precise per-id typing.
  writeTypeDeclSibling(abs, styled);

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

  const result = lowerUIToCpp(mod.styled, allBoxes, opts.colorFormat, opts.storage, mod.keyboards, mod.rules, getDisplayProfile(), mod.fontAssets, allStyled);
  lowered.set(abs, result);
  return result;
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

function writeTypeDeclSibling(htmlPath: string, styled: StyledNode): void {
  const dtsPath = htmlPath.replace(/\.ui\.html$/, ".ui.html.d.ts");
  const ids: Array<{ id: string; tag: string }> = [];
  const collect = (n: StyledNode) => {
    if (n.id) ids.push({ id: n.id, tag: n.tag });
    n.children.forEach(collect);
  };
  collect(styled);

  const fields = ids.map(({ id, tag }) => {
    const typeName = tag.charAt(0).toUpperCase() + tag.slice(1);
    return `  ${id}: ${typeName}Element;`;
  }).join("\n");

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
