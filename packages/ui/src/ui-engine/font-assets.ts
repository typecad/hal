import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import type { CSSFontFace, CSSProperty } from "./css-parser.js";
import type { StyledNode } from "./style-resolver.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";

export interface UIFontGlyphModel {
  codepoint: number;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  advance: number;
  /** Offset into the packed alpha stream — 4-bit pixels (alpha4) or bits
   *  (mono1), matching the asset's format. */
  dataOffset: number;
}

export type UIFontSubsetMode = "exact" | "fallback";

/** Glyph bitmap storage: 4-bit alpha nibbles (color targets) or 1bpp packed
 *  bits, MSB-first (mono targets — Stage 2). */
export type UIFontBitmapFormat = "alpha4" | "mono1";

export interface UIFontAssetModel {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  lineHeight: number;
  baseline: number;
  glyphs: UIFontGlyphModel[];
  alpha: number[];
  /** Defaults to "alpha4"; mono builds pack 1bpp glyphs instead. */
  format?: UIFontBitmapFormat;
}

interface FontAssetRequest {
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: Set<string>;
}

export interface UIFontAssetPlan {
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
}

interface OpenTypePathCommand {
  type: "M" | "L" | "C" | "Q" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface Point {
  x: number;
  y: number;
}

const FALLBACK_CHARS = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:;!?+-*/=%()[]{}<>_#@&^~$'|";
const SUPERSAMPLE = 4;
// Stage 2 mono glyph threshold: a pixel keeps its bit when coverage alpha
// reaches this (of 15). 8 (50%) reads as thin/patchy at small sizes — thin
// strokes of a 10px bold face sit near 30-45% coverage and drop out, leaving
// ragged "anti-aliased-looking" edges on the panel. 5 (~31%) keeps those
// strokes connected; heavier faces just read bolder, which is the right bias
// for emissive 1bpp panels.
export const MONO_ALPHA_THRESHOLD = 5;

// ── Built-in Classic bitmap family ──────────────────────────────────────────
// The shared Adafruit glcdfont 5x7 table, baked as a first-class font asset
// so `font-family: "Classic"` works with no @font-face. At native size the
// pixels are the hand-designed bitmap (perfect stems by construction); at 2x
// the doubling gets the Technoblogy diagonal-corner smoothing ("Smooth Big
// Text", David Johnson-Davies): when two horizontally adjacent source pixels
// form a one-row step (a staircase corner), the two sub-pixels at the step's
// inner corner are filled, so doubled diagonals read as connected 45° runs.
const CLASSIC_FONT_SRC = "builtin:classic";
const CLASSIC_FAMILY_RE = /^(?:classic|classic5x7|classic 5x7)$/i;
const CLASSIC_CELL_W = 5;
const CLASSIC_CELL_H = 8;

export function normalizeFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  if (!first) return undefined;
  if ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'"))) {
    return first.slice(1, -1);
  }
  return first;
}

export function fontPxOf(style: CSSProperty): number {
  if (!style.fontSize) return 16;
  const px = parseInt(style.fontSize, 10);
  return Number.isFinite(px) && px > 0 ? px : 16;
}

export function normalizeFontWeight(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "normal") return "400";
  if (normalized === "bold" || normalized === "bolder") return "700";
  if (normalized === "lighter") return "300";
  const numeric = /^(\d{1,4})/.exec(normalized);
  if (!numeric) return "400";
  const n = Math.max(1, Math.min(1000, Number(numeric[1])));
  return Number.isFinite(n) ? String(n) : "400";
}

export function normalizeFontStyle(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "normal") return "normal";
  if (normalized.includes("italic")) return "italic";
  if (normalized.includes("oblique")) return "oblique";
  return "normal";
}

export function fontSubsetOf(style: CSSProperty): UIFontSubsetMode {
  const subset = style.fontSubset?.trim().toLowerCase();
  if (!subset || subset === "exact" || subset === "used") return "exact";
  if (subset === "fallback" || subset === "auto" || subset === "ascii" || subset === "common") {
    return "fallback";
  }
  return "exact";
}

export function selectFontFaceForStyle(fontFaces: CSSFontFace[], style: CSSProperty): CSSFontFace | undefined {
  const family = normalizeFontFamily(style.fontFamily);
  if (!family) return undefined;
  const candidates = fontFaces.filter((face) => face.fontFamily.toLowerCase() === family.toLowerCase());
  if (candidates.length === 0) {
    // The built-in bitmap family needs no @font-face: `font-family: "Classic"`
    // bakes from the shared glcdfont table (native 5x7 pixels, plus the
    // smooth 2x doubling — see bakeClassicFontAsset). An explicit @font-face
    // with the same family name wins, so authors can override it.
    if (CLASSIC_FAMILY_RE.test(family)) {
      return { fontFamily: family, src: CLASSIC_FONT_SRC, fontWeight: "400", fontStyle: "normal" };
    }
    return undefined;
  }
  const desiredWeight = Number(normalizeFontWeight(style.fontWeight));
  const desiredStyle = normalizeFontStyle(style.fontStyle);
  return [...candidates].sort((a, b) =>
    fontFaceScore(a, desiredWeight, desiredStyle) - fontFaceScore(b, desiredWeight, desiredStyle)
  )[0];
}

export function selectFontAssetForStyle(fontAssets: UIFontAssetModel[], style: CSSProperty): UIFontAssetModel | undefined {
  const family = normalizeFontFamily(style.fontFamily);
  if (!family) return undefined;
  const px = fontPxOf(style);
  const candidates = fontAssets.filter((asset) => asset.family.toLowerCase() === family.toLowerCase() && asset.px === px);
  if (candidates.length === 0) return undefined;
  const desiredWeight = Number(normalizeFontWeight(style.fontWeight));
  const desiredStyle = normalizeFontStyle(style.fontStyle);
  return [...candidates].sort((a, b) =>
    fontAssetScore(a, desiredWeight, desiredStyle) - fontAssetScore(b, desiredWeight, desiredStyle)
  )[0];
}

/** Measure a string's pixel width using the real per-glyph advances of the
 *  asset font a node resolves to. Returns undefined when the node uses the
 *  default font (no matching asset), so callers fall back to the 6*ts advance.
 *  Characters missing from the asset's subset fall back to half the line height
 *  (matching the runtime's ui_asset_text_width fallback). */
export function assetTextWidth(text: string, style: CSSProperty, fontAssets: UIFontAssetModel[]): number | undefined {
  const asset = selectFontAssetForStyle(fontAssets, style);
  if (!asset) return undefined;
  if (text.length === 0) return 0;
  const fallback = Math.max(1, Math.floor(asset.lineHeight / 2));
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const glyph = asset.glyphs.find((g) => g.codepoint === cp);
    w += glyph ? glyph.advance : fallback;
  }
  return w;
}

/** The line height the runtime will render a custom-font node at
 *  (ui_asset_text_height → face->lineHeight), or undefined when the node uses
 *  the default font. Layout must use this for the glyph-cell height instead of
 *  the 8*ts GFX bitmap default, otherwise the laid-out box is shorter than the
 *  drawn glyphs and the text overflows its container (e.g. a bold @font-face
 *  title spilling past its header's padded box). Mirrors the preview's
 *  textHeight(size, fontFace) = asset.lineHeight ?? gfx.textHeight(size). */
export function assetLineHeight(style: CSSProperty, fontAssets: UIFontAssetModel[]): number | undefined {
  const asset = selectFontAssetForStyle(fontAssets, style);
  if (!asset || asset.lineHeight <= 0) return undefined;
  return asset.lineHeight;
}

export function buildUIFontAssets(
  root: StyledNode,
  fontFaces: CSSFontFace[],
  baseDir: string,
  dynamicNodeIds?: Set<string>,
): UIFontAssetModel[] {
  const plans = planUIFontAssets(root, fontFaces, baseDir, dynamicNodeIds);

  const parsedFonts = new Map<string, any>();
  const assets: UIFontAssetModel[] = [];
  let id = 1;
  for (const plan of plans) {
    if (plan.sourcePath === CLASSIC_FONT_SRC) {
      assets.push(bakeClassicFontAsset({
        id: id++,
        family: plan.family,
        px: plan.px,
        fontWeight: plan.fontWeight,
        fontStyle: plan.fontStyle,
        subset: plan.subset,
        chars: plan.chars,
      }));
      continue;
    }
    let font = parsedFonts.get(plan.sourcePath);
    if (!font) {
      const bytes = fs.readFileSync(plan.sourcePath);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      font = opentype.parse(arrayBuffer);
      parsedFonts.set(plan.sourcePath, font);
    }
    assets.push(rasterizeFontAsset({
      id: id++,
      family: plan.family,
      sourcePath: plan.sourcePath,
      px: plan.px,
      fontWeight: plan.fontWeight,
      fontStyle: plan.fontStyle,
      subset: plan.subset,
      chars: plan.chars,
      font,
    }));
  }

  return assets;
}

export function planUIFontAssets(
  root: StyledNode,
  fontFaces: CSSFontFace[],
  baseDir: string,
  dynamicNodeIds?: Set<string>,
): UIFontAssetPlan[] {
  // No early return on empty fontFaces: the built-in Classic family resolves
  // without any @font-face, so planning must walk the tree regardless.
  const requests = new Map<string, FontAssetRequest>();
  const collect = (node: StyledNode) => {
    const face = selectFontFaceForStyle(fontFaces, node.style);
    if (face) {
      // Runtime-dynamic text renders strings the static template can't
      // predict — widen those faces to the fallback charset so bound values
      // ("Gamma" against a subset planned from authored "mode: alpha") don't
      // drop glyphs. Dynamic = ui.bind(..., 'text') targets (via
      // dynamicNodeIds), {expr} interpolations, and bind:text attributes.
      const dynamicText =
        (node.id !== undefined && dynamicNodeIds?.has(node.id)) ||
        node.hasInterpolation === true ||
        node.bind?.text !== undefined;
      const px = fontPxOf(node.style);
      const sourcePath = resolveFontPath(face.src, baseDir);
      const fontWeight = normalizeFontWeight(face.fontWeight ?? node.style.fontWeight);
      const fontStyle = normalizeFontStyle(face.fontStyle ?? node.style.fontStyle);
      const key = `${sourcePath}:${px}:${fontWeight}:${fontStyle}`;
      let request = requests.get(key);
      if (!request) {
        request = {
          family: face.fontFamily,
          sourcePath,
          px,
          fontWeight,
          fontStyle,
          subset: "exact",
          chars: new Set<string>(),
        };
        requests.set(key, request);
      }
      if ((fontSubsetOf(node.style) === "fallback" || dynamicText) && request.subset !== "fallback") {
        request.subset = "fallback";
        addText(request.chars, FALLBACK_CHARS);
      }
      // Virtualized lists render RUNTIME text — item expressions produce
      // strings the static template can't predict (the same reason `{expr}`
      // interpolations add digits). Without this the list's face only carries
      // glyphs from unrelated static text and items render blanks (e.g. a
      // subset with '0' but no '1'-'9' draws "Item 10" as "Item  0").
      if (node.tag === "list" && request.subset !== "fallback") {
        request.subset = "fallback";
        addText(request.chars, FALLBACK_CHARS);
      }
      addNodeText(request.chars, node);
    }
    // Rich-text inline runs: each run has its own resolved style (bold, italic,
    // different font-size) which maps to a different font face/asset. Collect
    // each run's text under its OWN style so the per-face subsetting includes
    // the run's characters. Without this, the run's font face is subsetted from
    // unrelated text and glyphs go missing at draw time.
    if (node.runs) {
      for (const run of node.runs) {
        const runStyle = { ...node.style, ...run.style } as CSSProperty;
        const runFace = selectFontFaceForStyle(fontFaces, runStyle);
        if (!runFace) continue;
        const runPx = fontPxOf(runStyle);
        const runSourcePath = resolveFontPath(runFace.src, baseDir);
        const runWeight = normalizeFontWeight(runFace.fontWeight ?? runStyle.fontWeight);
        const runStyleAttr = normalizeFontStyle(runFace.fontStyle ?? runStyle.fontStyle);
        const runKey = `${runSourcePath}:${runPx}:${runWeight}:${runStyleAttr}`;
        let runReq = requests.get(runKey);
        if (!runReq) {
          runReq = {
            family: runFace.fontFamily,
            sourcePath: runSourcePath,
            px: runPx,
            fontWeight: runWeight,
            fontStyle: runStyleAttr,
            subset: "exact",
            chars: new Set<string>(),
          };
          requests.set(runKey, runReq);
        }
        addText(runReq.chars, applyTextTransform(run.text, runStyle));
      }
    }
    for (const child of node.children) collect(child);
  };
  collect(root);

  return [...requests.values()]
    .filter((request) => request.chars.size > 0)
    .map((request) => ({
      family: request.family,
      sourcePath: request.sourcePath,
      px: request.px,
      fontWeight: request.fontWeight,
      fontStyle: request.fontStyle,
      subset: request.subset,
      chars: [...request.chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!),
    }));
}

function resolveFontPath(src: string, baseDir: string): string {
  if (src === CLASSIC_FONT_SRC) return src;
  if (/^https?:\/\//i.test(src)) {
    throw new Error(`@font-face src "${src}" is remote; use a local font file for embedded builds.`);
  }
  const withoutFileScheme = src.startsWith("file://") ? src.slice("file://".length) : src;
  const resolved = path.isAbsolute(withoutFileScheme)
    ? withoutFileScheme
    : path.resolve(baseDir, withoutFileScheme);
  if (!fs.existsSync(resolved)) {
    throw new Error(`@font-face font file not found: ${resolved}`);
  }
  return resolved;
}

function fontFaceScore(face: CSSFontFace, desiredWeight: number, desiredStyle: string): number {
  const style = normalizeFontStyle(face.fontStyle);
  const weight = Number(normalizeFontWeight(face.fontWeight));
  return styleScore(style, desiredStyle) * 10000 + Math.abs(weight - desiredWeight);
}

function fontAssetScore(asset: UIFontAssetModel, desiredWeight: number, desiredStyle: string): number {
  const weight = Number(normalizeFontWeight(asset.fontWeight));
  return styleScore(asset.fontStyle, desiredStyle) * 10000 + Math.abs(weight - desiredWeight);
}

function styleScore(actual: string, desired: string): number {
  if (actual === desired) return 0;
  if (actual === "normal") return 1;
  return 2;
}

function addNodeText(chars: Set<string>, node: StyledNode): void {
  addText(chars, applyTextTransform(node.text, node.style));
  addText(chars, applyTextTransform(node.placeholder, node.style));
  for (const option of node.options ?? []) {
    addText(chars, applyTextTransform(option.text, node.style));
  }
  // Interpolation ({expr}) and text bindings produce runtime text the static
  // template can't predict (numbers, dates, etc). Add digits + common
  // formatting chars so the font subset can render the runtime output.
  if (node.text && node.text.includes("{")) {
    addText(chars, "0123456789.,-+/()%");
  }
      // <input> nodes on the SDL desktop target (UI_HIDE_OSK) accept arbitrary
      // real-keyboard text — the OSK grid isn't shown, so the user can type any
      // character, not just the keys on the on-screen grid. Pack the full printable
      // ASCII range so every typed character has a glyph (otherwise letters absent
      // from static UI text render blank — ui_font_glyph returns null). Mono
      // targets (Stage 2) also hide the OSK — same real-keyboard rationale.
      // Hardware TFT targets keep the minimal subset: the OSK grid is the only
      // input path and only carries the keys it shows.
      if (node.tag === "input") {
        let hideOsk = false;
        try { hideOsk = getDisplayProfile().driver === "sdl" || getDisplayProfile().colorFormat === "mono"; } catch { /* no profile bound */ }
        if (hideOsk) {
          let ascii = "";
          for (let cp = 0x20; cp <= 0x7e; cp++) ascii += String.fromCodePoint(cp);
          addText(chars, ascii);
        }
      }
}

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

function addText(chars: Set<string>, text: string | undefined): void {
  if (!text) return;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= 32 && cp <= 0xffff) chars.add(ch);
  }
}

function rasterizeFontAsset(options: {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
  font: any;
}): UIFontAssetModel {
  // Stage 2 mono: glyphs pack as 1bpp bits (MSB-first, 8 pixels/byte), with
  // dataOffset counting bits. The bit keeps the coverage MONO_ALPHA_THRESHOLD
  // selects — the single bake point; the runtime and preview both read the
  // packed bits as 15/0 alpha, so the panel shows these exact glyph shapes.
  let monoPack = false;
  try { monoPack = getDisplayProfile().colorFormat === "mono"; } catch { /* no profile bound */ }
  const scale = options.px / options.font.unitsPerEm;
  const baseline = Math.ceil((options.font.ascender ?? options.font.unitsPerEm) * scale) + 1;
  const lineHeight = Math.ceil(((options.font.ascender ?? options.font.unitsPerEm) - (options.font.descender ?? 0)) * scale) + 2;
  const glyphs: UIFontGlyphModel[] = [];
  const unpackedAlpha: number[] = [];
  const monoBits: number[] = [];

  for (const ch of options.chars) {
    const glyph = options.font.charToGlyph(ch);
    const advance = Math.max(1, Math.ceil((glyph.advanceWidth ?? options.font.unitsPerEm / 2) * scale));
    const path = glyph.getPath(0, 0, options.px);
    const rawContours = flattenPath(path.commands as OpenTypePathCommand[]);
    // Mono light hinting: snap stems onto the pixel grid BEFORE sampling, so
    // a 1.4px stem renders one constant integer width instead of wobbling
    // between 1 and 2 pixels along its length (the "bumps" plain coverage
    // thresholding shows at small sizes). Alpha4 keeps the raw outline and
    // its original path bbox, byte-identical to the pre-hinting bake.
    const contours = monoPack && rawContours.length > 0 ? monoHintContours(rawContours) : rawContours;
    const bbox = contours !== rawContours ? contoursBBox(contours) : path.getBoundingBox();
    const empty = !Number.isFinite(bbox.x1) || !Number.isFinite(bbox.y1) || bbox.x1 === bbox.x2 || bbox.y1 === bbox.y2;
    const xOffset = empty ? 0 : Math.floor(bbox.x1) - 1;
    const yOffset = empty ? 0 : Math.floor(bbox.y1) - 1;
    const width = empty ? 0 : Math.max(0, Math.ceil(bbox.x2) - xOffset + 1);
    const height = empty ? 0 : Math.max(0, Math.ceil(bbox.y2) - yOffset + 1);
    const dataOffset = monoPack ? monoBits.length : unpackedAlpha.length;

    if (width > 0 && height > 0) {
      const monoGlyph: number[] = [];
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          let covered = 0;
          for (let sy = 0; sy < SUPERSAMPLE; sy++) {
            for (let sx = 0; sx < SUPERSAMPLE; sx++) {
              const x = xOffset + px + (sx + 0.5) / SUPERSAMPLE;
              const y = yOffset + py + (sy + 0.5) / SUPERSAMPLE;
              if (pointInContours(x, y, contours)) covered++;
            }
          }
          const alpha = Math.round((covered * 15) / (SUPERSAMPLE * SUPERSAMPLE));
          if (monoPack) monoGlyph.push(alpha >= MONO_ALPHA_THRESHOLD ? 1 : 0);
          else unpackedAlpha.push(alpha);
        }
      }
      if (monoPack) {
        monoDespeckle(monoGlyph, width, height);
        for (const b of monoGlyph) monoBits.push(b);
      }
    }

    glyphs.push({
      codepoint: ch.codePointAt(0) ?? 0,
      xOffset,
      yOffset,
      width,
      height,
      advance,
      dataOffset,
    });
  }

  return {
    id: options.id,
    family: options.family,
    sourcePath: options.sourcePath,
    px: options.px,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
    subset: options.subset,
    lineHeight,
    baseline,
    glyphs,
    alpha: monoPack ? packBits(monoBits) : packNibbles(unpackedAlpha),
    format: monoPack ? "mono1" : "alpha4",
  };
}

/** Decode a glcdfont character into its 5x8 on/off grid (row 0 = top; the
 * table packs each column as a byte whose bit r is cell row r). */
function classicGlyphGrid(codepoint: number): boolean[][] | undefined {
  if (codepoint < 0 || codepoint * CLASSIC_CELL_W + CLASSIC_CELL_W > GLCDFONT_BYTES.length) return undefined;
  const grid: boolean[][] = [];
  for (let y = 0; y < CLASSIC_CELL_H; y++) grid.push(new Array<boolean>(CLASSIC_CELL_W).fill(false));
  for (let x = 0; x < CLASSIC_CELL_W; x++) {
    const col = GLCDFONT_BYTES[codepoint * CLASSIC_CELL_W + x] ?? 0;
    for (let y = 0; y < CLASSIC_CELL_H; y++) grid[y][x] = ((col >> y) & 1) === 1;
  }
  return grid;
}

/** Double a source grid (each pixel → a 2x2 block). When `smooth`, fill the
 * two sub-pixels at the inner corner of every one-row diagonal step between
 * horizontally adjacent source pixels — the Technoblogy "Smooth Big Text"
 * rule, which turns blocky doubled staircases into connected 45° runs
 * without touching stems (integer widths stay integer). */
function classicDoubleGrid(src: boolean[][], smooth: boolean): boolean[][] {
  const h = src.length;
  const w = src[0]?.length ?? 0;
  const big: boolean[][] = [];
  for (let y = 0; y < h * 2; y++) big.push(new Array<boolean>(w * 2).fill(false));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y]![x]) continue;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) big[y * 2 + dy]![x * 2 + dx] = true;
      }
    }
  }
  if (!smooth) return big;
  const on = (x: number, y: number): boolean =>
    x >= 0 && x < w && y >= 0 && y < h && src[y]![x] === true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      for (const dy of [1, -1] as const) {
        // A staircase step: ink at (x,y) and (x+1,y+dy) with both orthogonal
        // neighbor cells empty. The step's inner corner is bridged by the
        // sub-pixel of each empty cell that diagonally touches the other ink.
        if (on(x, y) && on(x + 1, y + dy) && !on(x + 1, y) && !on(x, y + dy)) {
          if (dy === 1) {
            big[y * 2 + 2]![x * 2 + 1] = true;
            big[y * 2 + 1]![x * 2 + 2] = true;
          } else {
            big[y * 2 - 1]![x * 2 + 1] = true;
            big[y * 2]![x * 2 + 2] = true;
          }
        }
      }
    }
  }
  return big;
}

/** Bake the built-in Classic (glcdfont 5x7) family. Sizes quantize to whole
 * cells: scale n = floor(px/8) (min 1) — 8px is the hand-designed native
 * bitmap, 16px doubles it with diagonal-corner smoothing, other scales
 * double cleanly without smoothing. Works for both mono1 and alpha4 targets
 * (bitmap bits are 0/15 alpha). */
function bakeClassicFontAsset(options: {
  id: number;
  family: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
}): UIFontAssetModel {
  const n = Math.max(1, Math.floor(options.px / 8));
  const smooth = n === 2;
  let monoPack = false;
  try { monoPack = getDisplayProfile().colorFormat === "mono"; } catch { /* no profile bound */ }
  const glyphs: UIFontGlyphModel[] = [];
  const monoBits: number[] = [];
  const unpackedAlpha: number[] = [];
  for (const ch of options.chars) {
    const codepoint = ch.codePointAt(0) ?? 0;
    const grid = classicGlyphGrid(codepoint);
    const hasInk = grid !== undefined && grid.some((row) => row.some(Boolean));
    const width = hasInk ? CLASSIC_CELL_W * n : 0;
    const height = hasInk ? CLASSIC_CELL_H * n : 0;
    const dataOffset = monoPack ? monoBits.length : unpackedAlpha.length;
    if (hasInk) {
      const bits = n === 1 ? grid! : classicDoubleGrid(grid!, smooth);
      for (const row of bits) {
        for (const b of row) {
          if (monoPack) monoBits.push(b ? 1 : 0);
          else unpackedAlpha.push(b ? 15 : 0);
        }
      }
    }
    glyphs.push({
      codepoint,
      xOffset: 0,
      yOffset: -(CLASSIC_CELL_H * n - 1),
      width,
      height,
      advance: (CLASSIC_CELL_W + 1) * n,
      dataOffset,
    });
  }
  return {
    id: options.id,
    family: options.family,
    sourcePath: CLASSIC_FONT_SRC,
    px: options.px,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
    subset: options.subset,
    lineHeight: CLASSIC_CELL_H * n,
    baseline: CLASSIC_CELL_H * n - 1,
    glyphs,
    alpha: monoPack ? packBits(monoBits) : packNibbles(unpackedAlpha),
    format: monoPack ? "mono1" : "alpha4",
  };
}

// ── Mono light hinting: stem snapping ───────────────────────────────────────
// A simplified FreeType-autohinter-in-mono-mode pass over the flattened
// contours, applied only on the 1bpp bake path:
//   1. Edge runs — maximal sequences of near-parallel path segments (a stem
//      side or a flat bar edge) become edges, positioned by their
//      length-weighted mean along the snapped axis.
//   2. Stem pairing — adjacent-in-position edges whose extents overlap and
//      whose gap is stem-like (0.55..2.6px) form a stem; the pair snaps so
//      BOTH edges land on integer pixels exactly `round(gap)` apart.
//   3. Unpaired edges (terminals, counters) snap to the nearest integer.
//   4. Every contour point shifts by the piecewise-linear interpolation of
//      its bracketing edges' deltas, so curves between snapped stems stay
//      smooth instead of tearing.
// Because all edges snap to the same integer lattice, stems share phase
// across glyphs (the i/l/t stems align) without any global table.
const MONO_HINT_STEM_MIN_PX = 0.55;
const MONO_HINT_STEM_MAX_PX = 2.6;
const MONO_HINT_RUN_MIN_PX = 0.7;
const MONO_HINT_MAX_SHIFT = 0.85;
const MONO_HINT_STEM_OVERLAP = 0.55;

interface MonoHintEdge {
  pos: number;
  lo: number;
  hi: number;
  delta: number;
}

function collectMonoEdges(contours: Point[][], axis: "x" | "y"): MonoHintEdge[] {
  const edges: MonoHintEdge[] = [];
  const other = axis === "x" ? "y" : "x";
  for (const contour of contours) {
    if (contour.length < 2) continue;
    let runLen = 0;
    let runPosSum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let runDir = 0;
    const flush = () => {
      if (runLen >= MONO_HINT_RUN_MIN_PX) {
        edges.push({ pos: runPosSum / runLen, lo, hi, delta: 0 });
      }
      runLen = 0;
      runPosSum = 0;
      lo = Infinity;
      hi = -Infinity;
      runDir = 0;
    };
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const snapD = b[axis] - a[axis];
      const otherD = b[other] - a[other];
      const otherLen = Math.abs(otherD);
      const dir = otherD > 0 ? 1 : otherD < 0 ? -1 : 0;
      const steers = otherLen > 1e-6 && Math.abs(snapD) <= 0.5 * otherLen && (runDir === 0 || dir === runDir);
      if (steers) {
        runLen += otherLen;
        runPosSum += ((a[axis] + b[axis]) / 2) * otherLen;
        lo = Math.min(lo, a[other], b[other]);
        hi = Math.max(hi, a[other], b[other]);
        runDir = dir;
      } else if (otherLen > 1e-6) {
        flush();
        // The segment that broke the run may itself steer a new one.
        if (Math.abs(snapD) <= 0.5 * otherLen) {
          runLen = otherLen;
          runPosSum = ((a[axis] + b[axis]) / 2) * otherLen;
          lo = Math.min(a[other], b[other]);
          hi = Math.max(a[other], b[other]);
          runDir = dir;
        }
      }
    }
    flush();
  }
  return edges;
}

function monoAxisShift(edges: MonoHintEdge[]): (v: number) => number {
  if (edges.length === 0) return () => 0;
  edges.sort((a, b) => a.pos - b.pos);
  const clamp = (d: number) => Math.max(-MONO_HINT_MAX_SHIFT, Math.min(MONO_HINT_MAX_SHIFT, d));
  const paired = new Array<boolean>(edges.length).fill(false);
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    if (paired[i] || paired[i + 1]) continue;
    const gap = b.pos - a.pos;
    const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
    const minExtent = Math.min(a.hi - a.lo, b.hi - b.lo);
    if (gap < MONO_HINT_STEM_MIN_PX || gap > MONO_HINT_STEM_MAX_PX) continue;
    if (minExtent <= 0 || overlap < MONO_HINT_STEM_OVERLAP * minExtent) continue;
    const stemW = Math.max(1, Math.round(gap));
    const newLeft = Math.round(a.pos + (stemW - gap) / 2);
    a.delta = clamp(newLeft - a.pos);
    b.delta = clamp(newLeft + stemW - b.pos);
    paired[i] = true;
    paired[i + 1] = true;
  }
  for (let i = 0; i < edges.length; i++) {
    if (!paired[i]) edges[i].delta = clamp(Math.round(edges[i].pos) - edges[i].pos);
  }
  return (v: number): number => {
    if (v <= edges[0].pos) return edges[0].delta;
    const last = edges[edges.length - 1];
    if (v >= last.pos) return last.delta;
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      if (v >= a.pos && v <= b.pos) {
        const t = b.pos > a.pos ? (v - a.pos) / (b.pos - a.pos) : 0;
        return clamp(a.delta + t * (b.delta - a.delta));
      }
    }
    return 0;
  };
}

/** Snap a glyph's stems onto the pixel grid (mono bake only). */
export function monoHintContours(contours: Point[][]): Point[][] {
  const shiftX = monoAxisShift(collectMonoEdges(contours, "x"));
  const shiftY = monoAxisShift(collectMonoEdges(contours, "y"));
  return contours.map((c) =>
    c.map((p) => ({ x: p.x + shiftX(p.x), y: p.y + shiftY(p.y) })),
  );
}

function contoursBBox(contours: Point[][]): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
  }
  return { x1, y1, x2, y2 };
}

// Binary finishing pass on the baked 1bpp glyph: drop isolated specks the
// threshold leaves at curve tails (no orthogonal neighbors and at most one
// diagonal), and close plus-shaped single-pixel holes inside strokes.
// Tiny-mark glyphs (a middot or period at 10px is a single pixel) are exempt —
// their only ink IS an isolated pixel, not a speck beside a stroke.
function monoDespeckle(bits: number[], w: number, h: number): void {
  if (w < 3 || h < 3) return;
  let ink = 0;
  for (const b of bits) ink += b;
  if (ink < 4) return;
  const src = bits.slice();
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const n4 = at(x, y - 1) + at(x, y + 1) + at(x - 1, y) + at(x + 1, y);
      if (src[i] === 1) {
        if (n4 === 0) {
          const diag =
            at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1);
          if (diag <= 1) bits[i] = 0;
        }
      } else if (n4 === 4) {
        bits[i] = 1;
      }
    }
  }
}

function flattenPath(commands: OpenTypePathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point | null = null;
  let contour: Point[] = [];

  const push = (p: Point) => {
    contour.push(p);
    current = p;
  };
  const finish = () => {
    if (contour.length > 1) contours.push(contour);
    contour = [];
    start = null;
  };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      finish();
      current = { x: cmd.x ?? 0, y: cmd.y ?? 0 };
      start = current;
      contour = [current];
    } else if (cmd.type === "L") {
      push({ x: cmd.x ?? current.x, y: cmd.y ?? current.y });
    } else if (cmd.type === "Q") {
      const p0 = current;
      const p1 = { x: cmd.x1 ?? current.x, y: cmd.y1 ?? current.y };
      const p2 = { x: cmd.x ?? current.x, y: cmd.y ?? current.y };
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        push({
          x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
          y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
        });
      }
    } else if (cmd.type === "C") {
      const p0 = current;
      const p1 = { x: cmd.x1 ?? current.x, y: cmd.y1 ?? current.y };
      const p2 = { x: cmd.x2 ?? current.x, y: cmd.y2 ?? current.y };
      const p3 = { x: cmd.x ?? current.x, y: cmd.y ?? current.y };
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const mt = 1 - t;
        push({
          x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
          y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
        });
      }
    } else if (cmd.type === "Z") {
      if (start) push(start);
      finish();
    }
  }
  finish();
  return contours;
}

function pointInContours(x: number, y: number, contours: Point[][]): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const a = contour[i];
      const b = contour[j];
      const crosses = (a.y > y) !== (b.y > y);
      if (crosses) {
        const ix = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
        if (x < ix) inside = !inside;
      }
    }
  }
  return inside;
}

function packNibbles(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 2) {
    const hi = Math.max(0, Math.min(15, values[i] ?? 0));
    const lo = Math.max(0, Math.min(15, values[i + 1] ?? 0));
    out.push((hi << 4) | lo);
  }
  return out;
}

/** Pack a 0/1 bit stream into bytes, MSB-first (matches the runtime's
 *  ui_font_alpha_at mono1 unpack and the UIImage bit layout). */
function packBits(bits: number[]): number[] {
  const out: number[] = [];
  let byte = 0;
  let n = 0;
  for (const b of bits) {
    byte = (byte << 1) | (b ? 1 : 0);
    n++;
    if (n === 8) {
      out.push(byte);
      byte = 0;
      n = 0;
    }
  }
  if (n > 0) out.push(byte << (8 - n));
  return out;
}
