import fs from "node:fs";
import path from "node:path";
// opentype.js ^2 is load-bearing: pair kerning via GPOS lookups (getKerningValue)
// and the legacy kern table (kerningPairs) both need the 2.x APIs/tables.
import opentype from "opentype.js";
import type { CSSFontFace, CSSProperty } from "./css-parser.js";
import type { StyledNode } from "./style-resolver.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

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

// Kerning pair type + the runtime-mirrored lookup live in font-kern.ts (a
// browser-safe leaf — the preview's host runtime loads in the browser, and
// this module imports node:fs). Re-exported so bake/test importers are
// unchanged.
export { kernPairValue } from "./font-kern.js";
export type { UIFontKernPair } from "./font-kern.js";
import { kernPairValue } from "./font-kern.js";
import type { UIFontKernPair } from "./font-kern.js";

/** Emission cap: kernCount is a uint8_t in the runtime face struct. Real
 *  faces carry a few hundred pairs at most, so this only trims pathological
 *  fonts, keeping the strongest pairs. */
const KERN_PAIR_MAX = 255;

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
  /** Kerning pairs for this face (subset-local indices, whole pixels). */
  kern?: UIFontKernPair[];
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
// Small-size relief: at <=10px thin diagonals (a % slash, an R leg) carry
// coverage just under the global threshold and drop to disconnected dots.
// One threshold notch recovers them; stems are already at their floor so
// the cost is a slightly bolder small size.
export function monoAlphaThresholdFor(px: number): number {
  return px <= 10 ? 4 : MONO_ALPHA_THRESHOLD;
}
// Panel-trial toggles (2026-09-16 ladder A/B): corner bridging and blue
// zones OFF to judge their contribution. Flip either back to true to
// re-enable — no other wiring changes.
export const MONO_CORNER_BRIDGE_ENABLED = false;
export const MONO_BLUE_ZONES_ENABLED = false;

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
  if (candidates.length === 0) return undefined;
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
  const indexOf = new Map<number, number>();
  for (let i = 0; i < asset.glyphs.length; i++) indexOf.set(asset.glyphs[i]!.codepoint, i);
  let w = 0;
  let prev = -1;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const gi = indexOf.get(cp);
    const glyph = gi === undefined ? undefined : asset.glyphs[gi]!;
    w += glyph ? glyph.advance : fallback;
    // Same kern the runtime and preview apply at the cursor, so layout
    // (wrapping, centering) measures what drawing actually renders.
    if (prev >= 0 && gi !== undefined) w += kernPairValue(asset, prev, gi);
    prev = gi ?? -1;
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
    // LVGL font-converter output (.c) is a bitmap source: glyphs come from
    // the file as-is (its own size/metrics), not from an outline raster.
    if (plan.sourcePath.endsWith(".c")) {
      const lvgl = parseLvglFontC(fs.readFileSync(plan.sourcePath, "utf8"));
      if (lvgl) {
        assets.push(bakeLvglFontAsset({ id: id++, family: plan.family, sourcePath: plan.sourcePath, px: plan.px, fontWeight: plan.fontWeight, fontStyle: plan.fontStyle, subset: plan.subset, chars: plan.chars, lvgl }));
        continue;
      }
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
  if (fontFaces.length === 0) return [];

  const requests = new Map<string, FontAssetRequest>();
  // Mono panels exist to show runtime values — uptimes, counts, sensor
  // strings arrive through ui.bind(..., 'text'), which THIS layer cannot see
  // (the bindings live in the script the engine parses separately; only
  // markup-level bind attributes and {expr} are visible here). The rig demo
  // proved the gap: its face subset carried exactly the static text's 31
  // glyphs, so the bound "t=12.5s" drew "t=1 s" on the panel — 2, ., 5 were
  // never baked. On mono, every face widens to the fallback charset
  // unconditionally (~0.7KB of mono1 bits); color targets keep the precise
  // per-node conditions below.
  let monoDisplay = false;
  try { monoDisplay = getDisplayProfile().colorFormat === "mono"; } catch { /* no profile bound */ }
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
      if (
        (fontSubsetOf(node.style) === "fallback" || dynamicText || monoDisplay) &&
        request.subset !== "fallback"
      ) {
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
  const yZones = monoPack && MONO_BLUE_ZONES_ENABLED ? monoYZoneTable(options.font, options.px) : undefined;

  for (const ch of options.chars) {
    const glyph = options.font.charToGlyph(ch);
    const advance = Math.max(1, Math.ceil((glyph.advanceWidth ?? options.font.unitsPerEm / 2) * scale));
    // Mono raster path — TrueType hinting FIRST: fonts shipping hinting
    // bytecode (DejaVu does) get the designer's own per-size grid fitting
    // executed by opentype.js's interpreter (getPath with { hinting: true }
    // + font returns pixel-space commands). It outperforms our geometric
    // snapping at every size we've measured — even 1px walls, connected
    // thin diagonals, clean round glyphs at 10px — so when it applies, our
    // hinting stack below is SKIPPED (double-hinting would fight it).
    // Fonts without instructions (CFF, stripped) fall back to the stack.
    let path = glyph.getPath(0, 0, options.px);
    let ttHinted = false;
    if (monoPack && options.font.hinting) {
      try {
        path = glyph.getPath(0, 0, options.px, { hinting: true }, options.font);
        ttHinted = true;
      } catch { /* interpreter refused — fall back to the raw outline */ }
    }
    const rawContours = flattenPath(path.commands as OpenTypePathCommand[]);
    // Mono light hinting (fallback path): snap stems onto the pixel grid
    // BEFORE sampling, so a 1.4px stem renders one constant integer width
    // instead of wobbling between 1 and 2 pixels along its length (the
    // "bumps" plain coverage thresholding shows at small sizes). Alpha4
    // keeps the raw outline and its original path bbox, byte-identical to
    // the pre-hinting bake.
    // Blue zones align the shared design heights (baseline, x-height,
    // cap-height) across every glyph of the face.
    const contours =
      monoPack && !ttHinted && rawContours.length > 0
        ? monoHintContours(rawContours, yZones)
        : rawContours;
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
          if (monoPack) monoGlyph.push(alpha >= monoAlphaThresholdFor(options.px) ? 1 : 0);
          else unpackedAlpha.push(alpha);
        }
      }
      if (monoPack) {
        monoDespeckle(monoGlyph, width, height);
        if (MONO_CORNER_BRIDGE_ENABLED) monoSmoothDiagonals(monoGlyph, width, height);
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
    kern: computeKernPairs(options.font, glyphs, options.px / options.font.unitsPerEm),
    format: monoPack ? "mono1" : "alpha4",
  };
}

/** Bake the kerning pairs for a face's subset. opentype.js ^2 exposes pair
 * kerning two ways: `font.getKerningValue` walks GPOS kern lookups (but
 * returns 0 — never falling back — whenever the font also carries a legacy
 * `kern` table it can't fully evaluate, which is exactly DejaVu's shape),
 * and `font.kerningPairs` holds the legacy table as a flat map. Merging
 * both, scaled to whole pixels, covers every font either way. All-pairs over
 * the subset is O(n²) lookups at build time only — trivial for n ≤ ~100. */
function computeKernPairs(
  font: any,
  glyphs: UIFontGlyphModel[],
  scale: number,
): UIFontKernPair[] {
  const localIndexOf = new Map<number, number>();
  for (let i = 0; i < glyphs.length; i++) {
    const gi = font.charToGlyphIndex(String.fromCodePoint(glyphs[i]!.codepoint));
    if (gi) localIndexOf.set(gi, i);
  }
  if (localIndexOf.size < 2) return [];
  const legacy: Record<string, number> = font.kerningPairs ?? {};
  const out: UIFontKernPair[] = [];
  for (const [li, i] of localIndexOf) {
    for (const [rj, j] of localIndexOf) {
      let units = 0;
      try { units = font.getKerningValue(li, rj) ?? 0; } catch { units = 0; }
      if (!units) units = legacy[`${li},${rj}`] ?? 0;
      if (!units) continue;
      const px = Math.round(units * scale);
      if (px !== 0) out.push({ l: i, r: j, v: px });
    }
  }
  if (out.length > KERN_PAIR_MAX) {
    out.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    out.length = KERN_PAIR_MAX;
  }
  out.sort((a, b) => a.l - b.l || a.r - b.r);
  return out;
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
// Blue-zone tolerance: an edge within this many px of a design height snaps
// to the zone. Half the stem-pairing window — wide enough to catch drift,
// narrow enough that x-height and cap-height never collide (≥1px apart).
const MONO_HINT_ZONE_TOL_PX = 0.35;
// Max width deformation a snapped stem may impose on its stroke. Strokes
// near integer width snap; anything needing more distortion stays designed
// (the deformation squeezes the curves attached to the stroke — the 'd'
// bowl bars and 'm' arch thinned below the draw threshold before this).
// 0.4 admits genuinely-wide stems (DejaVu's '1' carries a 1.64px stem that
// snaps cleanly to 2px at deform 0.36).
const MONO_HINT_MAX_DEFORM_PX = 0.4;

/** A y-axis blue zone: a shared design height in path coordinates (negative
 *  above the baseline) and the integer row every near edge should land on. */
export interface MonoYZone {
  coord: number;
  snap: number;
}

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

function monoAxisShift(
  edges: MonoHintEdge[],
  zones?: MonoYZone[],
  inkBetween?: (aPos: number, bPos: number, lo: number, hi: number) => boolean,
): (v: number) => number {
  if (edges.length === 0) return () => 0;
  edges.sort((a, b) => a.pos - b.pos);
  // Coalesce adjacent edges closer than the minimum stroke width: they are
  // fragments of ONE physical edge (split by curve junctions / sampling),
  // not a stroke. A stem's edge often splits where the run's direction
  // breaks (an h's inner-left edge at the arch, a curved g wall into three
  // pieces); left split, the fragments snap independently and smear the
  // wall across two columns (the 10px g rendered a fat 2px right wall
  // against 1px neighbors). Iterate to a fixpoint, then pair strokes.
  let coalesced = true;
  while (coalesced) {
    coalesced = false;
    for (let i = 0; i + 1 < edges.length; i++) {
      if (edges[i + 1].pos - edges[i].pos < MONO_HINT_STEM_MIN_PX) {
        const a = edges[i]!;
        const b = edges[i + 1]!;
        const total = a.hi - a.lo + (b.hi - b.lo);
        edges.splice(i, 2, {
          pos: total > 0 ? (a.pos * (a.hi - a.lo) + b.pos * (b.hi - b.lo)) / total : (a.pos + b.pos) / 2,
          lo: Math.min(a.lo, b.lo),
          hi: Math.max(a.hi, b.hi),
          delta: 0,
        });
        coalesced = true;
      }
    }
  }
  const clamp = (d: number) => Math.max(-MONO_HINT_MAX_SHIFT, Math.min(MONO_HINT_MAX_SHIFT, d));
  // Blue zones (y axis): an edge within tolerance of a shared design height
  // (baseline, x-height, cap-height) snaps to the ZONE's integer rather than
  // its own nearest — glyph-to-glyph drift that crosses an integer boundary
  // (tops at -5.36 vs -5.51) would otherwise round to different rows.
  const zoneTarget = (pos: number): number | undefined => {
    if (!zones || zones.length === 0) return undefined;
    let best: { snap: number; dist: number } | undefined;
    for (const z of zones) {
      const dist = Math.abs(pos - z.coord);
      if (dist <= MONO_HINT_ZONE_TOL_PX && (!best || dist < best.dist)) best = { snap: z.snap, dist };
    }
    return best?.snap;
  };
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
    // A pair is a STROKE only when ink fills the space between its edges
    // (the two sides of one bar/stem). Adjacent edges can also bound a
    // COUNTER — an o's inner walls, an R bowl's top and bottom bars — and
    // pairing those snaps the bowl shut and shears everything attached
    // (the R's leg collapsed to a nub: it read as a P on the panel).
    if (inkBetween && !inkBetween(a.pos, b.pos, Math.max(a.lo, b.lo), Math.min(a.hi, b.hi))) continue;
    const stemW = Math.max(1, Math.round(gap));
    // Snapping deforms the stroke by |stemW - gap| (distributed to both
    // edges) and the surrounding curve points interpolate that squeeze.
    // Strokes already near an integer width (within 0.3px) snap cleanly;
    // anything further would visibly thin or fatten the stroke and smear
    // the attached curves — leave those at their designed width.
    if (Math.abs(stemW - gap) > MONO_HINT_MAX_DEFORM_PX) continue;
    const newLeft = Math.round(a.pos + (stemW - gap) / 2);
    a.delta = clamp(newLeft - a.pos);
    b.delta = clamp(newLeft + stemW - b.pos);
    // A paired bar sitting at a zone (an E's top bar at cap height) shifts
    // WHOLE — both edges by the same amount, preserving the integer width.
    const zone = zoneTarget(a.pos);
    if (zone !== undefined) {
      const shift = clamp((zone - a.pos) - a.delta);
      a.delta = clamp(a.delta + shift);
      b.delta = clamp(b.delta + shift);
    }
    paired[i] = true;
    paired[i + 1] = true;
  }
  for (let i = 0; i < edges.length; i++) {
    if (!paired[i]) {
      const target = zoneTarget(edges[i].pos) ?? Math.round(edges[i].pos);
      edges[i].delta = clamp(target - edges[i].pos);
    }
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

/** Derive the face's blue zones at a pixel size: baseline (0), x-height,
 *  cap-height — in glyph path coordinates (y down, negative above baseline).
 *  Heights come from OS/2 sxHeight/sCapHeight when the font carries them
 *  (version 2+) and from the 'x'/'H' glyph metrics otherwise (DejaVu ships
 *  an older OS/2). Returns undefined when nothing beyond the baseline is
 *  derivable — hinting then behaves exactly as before. */
export function monoYZoneTable(font: any, px: number): MonoYZone[] | undefined {
  const metricOf = (units: number | undefined, fallbackChar: string): number | undefined => {
    if (units && units > 0) return units;
    try {
      const g = font.charToGlyph(fallbackChar);
      const yMax = g?.getMetrics?.()?.yMax;
      return yMax && yMax > 0 ? yMax : undefined;
    } catch {
      return undefined;
    }
  };
  const upm = font.unitsPerEm;
  if (!upm) return undefined;
  const os2 = font.tables?.os2;
  const heights = [
    metricOf(os2?.sxHeight, "x"),
    metricOf(os2?.sCapHeight, "H"),
  ].filter((u): u is number => u !== undefined);
  if (heights.length === 0) return undefined;
  const zones: MonoYZone[] = [{ coord: 0, snap: 0 }];
  for (const units of heights) {
    const coord = (units * -px) / upm;
    zones.push({ coord, snap: Math.round(coord) });
  }
  return zones;
}

/** Snap a glyph's stems onto the pixel grid (mono bake only). yZones (blue
 * zones) align shared design heights across glyphs when provided. */
export function monoHintContours(contours: Point[][], yZones?: MonoYZone[]): Point[][] {
  // Pair-legitimacy probe: is there glyph ink halfway between the two
  // candidate edges, at the middle of their overlap? Ink → the edges bound
  // one stroke; blank → they bound a counter (o's inner walls, an R bowl's
  // top/bottom bars) and must not pair.
  const inkBetweenX = (aPos: number, bPos: number, lo: number, hi: number): boolean =>
    hi > lo && pointInContours((aPos + bPos) / 2, (lo + hi) / 2, contours);
  const inkBetweenY = (aPos: number, bPos: number, lo: number, hi: number): boolean =>
    hi > lo && pointInContours((lo + hi) / 2, (aPos + bPos) / 2, contours);
  const shiftX = monoAxisShift(collectMonoEdges(contours, "x"), undefined, inkBetweenX);
  const shiftY = monoAxisShift(collectMonoEdges(contours, "y"), yZones, inkBetweenY);
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

// Diagonal corner bridging — the Technoblogy "Smooth Big Text" rule
// (technoblogy.com/show?3AJ7) transposed from its 2x home to native scale:
// when ink at (x,y) and (x+1,y±1) forms a staircase step with both notch
// cells empty, the 2x version fills the two inner-corner sub-pixels; at 1x
// the equivalent is filling ONE notch cell, which turns the disconnected
// staircase into an 8-connected diagonal that reads as a smooth 45-degree
// run on the panel. The candidate with more existing ink around it wins, so
// fills tuck into the stroke instead of protruding.
function monoSmoothDiagonals(bits: number[], w: number, h: number): void {
  if (w < 3 || h < 3) return;
  const src = bits.slice();
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x];
  const neighbors = (x: number, y: number): number =>
    at(x - 1, y - 1) + at(x, y - 1) + at(x + 1, y - 1) +
    at(x - 1, y) + at(x + 1, y) +
    at(x - 1, y + 1) + at(x, y + 1) + at(x + 1, y + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      if (at(x, y) !== 1) continue;
      for (const dy of [1, -1] as const) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        // A staircase step: diagonal ink with BOTH orthogonal notch cells empty.
        if (at(x + 1, ny) !== 1 || at(x + 1, y) !== 0 || at(x, ny) !== 0) continue;
        if (neighbors(x + 1, y) >= neighbors(x, ny)) bits[y * w + (x + 1)] = 1;
        else bits[ny * w + x] = 1;
      }
    }
  }
}

// ── LVGL font-converter sources (.c) ────────────────────────────────────────
// `lv_font_conv --format lvgl --bpp 1 --no-compress` output is a bitmap font:
// per-glyph byte-aligned 1bpp bitmaps (bit-continuous MSB-first within a
// glyph — our mono1 cell layout), metrics in glyph_dsc (adv_w in 1/16 px),
// codepoint ranges in cmaps, line geometry in the trailing lv_font_t.
// Empirically (verified against 'A'/'g' shapes): a bitmap's BOTTOM sits
// −ofs_y relative to the baseline, so our top-relative yOffset is
// −ofs_y − box_h, and the baseline sits line_height − base_line from the
// cell top. kern_dsc is NULL unless the converter is asked for kerning.

interface LvglGlyph {
  codepoint: number;
  advPx: number;
  boxW: number;
  boxH: number;
  ofsX: number;
  ofsY: number;
  bitmapIndex: number;
}

interface LvglFont {
  bitmap: number[];
  glyphs: LvglGlyph[];
  lineHeight: number;
  baseline: number;
}

export function parseLvglFontC(text: string): LvglFont | undefined {
  if (!text.includes("lv_font_fmt_txt") && !text.includes("lv_font_t")) return undefined;
  const bitmapMatch = /glyph_bitmap\[\]\s*=\s*\{([\s\S]*?)\};/.exec(text);
  const dscMatch = /glyph_dsc\[\]\s*=\s*\{([\s\S]*?)\};/.exec(text);
  if (!bitmapMatch || !dscMatch) return undefined;
  const bitmap = [...bitmapMatch[1].matchAll(/0x([0-9a-fA-F]+)/g)].map((m) => parseInt(m[1]!, 16));
  const glyphRows = [...dscMatch[1].matchAll(
    /\{\s*\.bitmap_index\s*=\s*(\d+)\s*,\s*\.adv_w\s*=\s*(\d+)\s*,\s*\.box_w\s*=\s*(\d+)\s*,\s*\.box_h\s*=\s*(\d+)\s*,\s*\.ofs_x\s*=\s*(-?\d+)\s*,\s*\.ofs_y\s*=\s*(-?\d+)\s*\}/g,
  )];
  if (glyphRows.length === 0) return undefined;
  // cmaps map codepoints to glyph-table rows (FORMAT0_TINY: contiguous
  // range starting at glyph_id_start; row 0 is reserved).
  const glyphByCodepoint = new Map<number, number>();
  for (const cm of text.matchAll(/\.range_start\s*=\s*(\d+)\s*,\s*\.range_length\s*=\s*(\d+)\s*,\s*\.glyph_id_start\s*=\s*(\d+)/g)) {
    const start = parseInt(cm[1]!, 10);
    const length = parseInt(cm[2]!, 10);
    const gidStart = parseInt(cm[3]!, 10);
    for (let i = 0; i < length; i++) glyphByCodepoint.set(start + i, gidStart + i);
  }
  const glyphs: LvglGlyph[] = [];
  for (let row = 1; row < glyphRows.length; row++) {
    const g = glyphRows[row]!;
    const cp = [...glyphByCodepoint.entries()].find(([, gid]) => gid === row)?.[0];
    if (cp === undefined) continue;
    glyphs.push({
      codepoint: cp,
      advPx: Math.round(parseInt(g[2]!, 10) / 16),
      boxW: parseInt(g[3]!, 10),
      boxH: parseInt(g[4]!, 10),
      ofsX: parseInt(g[5]!, 10),
      ofsY: parseInt(g[6]!, 10),
      bitmapIndex: parseInt(g[1]!, 10),
    });
  }
  const lineHeight = parseInt(/\.line_height\s*=\s*(\d+)/.exec(text)?.[1] ?? "0", 10);
  const baseLine = parseInt(/\.base_line\s*=\s*(\d+)/.exec(text)?.[1] ?? "0", 10);
  if (glyphs.length === 0 || lineHeight <= 0) return undefined;
  return { bitmap, glyphs, lineHeight, baseline: Math.max(0, lineHeight - baseLine) };
}

/** Bake an LVGL-converted .c font. The file's own size/metrics are the
 *  truth; `px` only keys asset selection (the author's font-size should
 *  match the converted size). Characters the file doesn't cover get an
 *  empty glyph with a space-like advance — the runtime draws a gap. */
function bakeLvglFontAsset(options: {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  fontWeight: string;
  fontStyle: string;
  subset: UIFontSubsetMode;
  chars: string[];
  lvgl: LvglFont;
}): UIFontAssetModel {
  let monoPack = false;
  try { monoPack = getDisplayProfile().colorFormat === "mono"; } catch { /* no profile bound */ }
  if (!monoPack) {
    throw new Error(
      `LVGL font ${options.sourcePath} is 1bpp — only mono display profiles can bake it.`,
    );
  }
  const byCp = new Map(options.lvgl.glyphs.map((g) => [g.codepoint, g]));
  const glyphs: UIFontGlyphModel[] = [];
  const monoBits: number[] = [];
  for (const ch of options.chars) {
    const cp = ch.codePointAt(0) ?? 0;
    const src = byCp.get(cp);
    const dataOffset = monoBits.length;
    let width = 0;
    let height = 0;
    let xOffset = 0;
    let yOffset = 0;
    let advance = Math.max(1, Math.round(options.lvgl.lineHeight / 2));
    if (src && src.boxW > 0 && src.boxH > 0) {
      width = src.boxW;
      height = src.boxH;
      xOffset = src.ofsX;
      yOffset = -src.ofsY - src.boxH;
      advance = Math.max(1, src.advPx);
      for (let i = 0; i < width * height; i++) {
        const bit = src.bitmapIndex * 8 + i;
        monoBits.push((options.lvgl.bitmap[bit >> 3]! >> (7 - (bit & 7))) & 1);
      }
    }
    glyphs.push({ codepoint: cp, xOffset, yOffset, width, height, advance, dataOffset });
  }
  return {
    id: options.id,
    family: options.family,
    sourcePath: options.sourcePath,
    px: options.px,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
    subset: options.subset,
    lineHeight: options.lvgl.lineHeight,
    baseline: options.lvgl.baseline,
    glyphs,
    alpha: packBits(monoBits),
    kern: [],
    format: "mono1",
  };
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
