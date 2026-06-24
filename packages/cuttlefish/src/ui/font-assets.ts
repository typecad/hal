import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import type { CSSFontFace, CSSProperty } from "./css-parser.js";
import type { StyledNode } from "./style-resolver.js";

export interface UIFontGlyphModel {
  codepoint: number;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  advance: number;
  /** Offset into the packed alpha stream, measured in 4-bit pixels. */
  dataOffset: number;
}

export interface UIFontAssetModel {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  lineHeight: number;
  baseline: number;
  glyphs: UIFontGlyphModel[];
  alpha: number[];
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

const FALLBACK_CHARS = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:;!?+-*/=%()[]{}<>_#@&";
const SUPERSAMPLE = 4;

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

export function buildUIFontAssets(
  root: StyledNode,
  fontFaces: CSSFontFace[],
  baseDir: string,
): UIFontAssetModel[] {
  if (fontFaces.length === 0) return [];

  const faces = new Map<string, CSSFontFace>();
  for (const face of fontFaces) {
    faces.set(face.fontFamily.toLowerCase(), face);
  }

  const charsByKey = new Map<string, Set<string>>();
  const collect = (node: StyledNode) => {
    const family = normalizeFontFamily(node.style.fontFamily);
    if (family && faces.has(family.toLowerCase())) {
      const px = fontPxOf(node.style);
      const key = `${family.toLowerCase()}:${px}`;
      let chars = charsByKey.get(key);
      if (!chars) {
        chars = new Set(FALLBACK_CHARS);
        charsByKey.set(key, chars);
      }
      addText(chars, node.text);
      addText(chars, node.placeholder);
      for (const option of node.options ?? []) addText(chars, option.text);
    }
    for (const child of node.children) collect(child);
  };
  collect(root);

  const parsedFonts = new Map<string, any>();
  const assets: UIFontAssetModel[] = [];
  let id = 1;
  for (const [key, chars] of charsByKey) {
    const [familyLower, pxText] = key.split(":");
    const face = faces.get(familyLower);
    if (!face) continue;
    const sourcePath = resolveFontPath(face.src, baseDir);
    let font = parsedFonts.get(sourcePath);
    if (!font) {
      const bytes = fs.readFileSync(sourcePath);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      font = opentype.parse(arrayBuffer);
      parsedFonts.set(sourcePath, font);
    }
    assets.push(rasterizeFontAsset({
      id: id++,
      family: face.fontFamily,
      sourcePath,
      px: Number(pxText) || 16,
      chars: [...chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!),
      font,
    }));
  }

  return assets;
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

function addText(chars: Set<string>, text: string | undefined): void {
  if (!text) return;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= 32 && cp <= 255) chars.add(ch);
  }
}

function rasterizeFontAsset(options: {
  id: number;
  family: string;
  sourcePath: string;
  px: number;
  chars: string[];
  font: any;
}): UIFontAssetModel {
  const scale = options.px / options.font.unitsPerEm;
  const baseline = Math.ceil((options.font.ascender ?? options.font.unitsPerEm) * scale) + 1;
  const lineHeight = Math.ceil(((options.font.ascender ?? options.font.unitsPerEm) - (options.font.descender ?? 0)) * scale) + 2;
  const glyphs: UIFontGlyphModel[] = [];
  const unpackedAlpha: number[] = [];

  for (const ch of options.chars) {
    const glyph = options.font.charToGlyph(ch);
    const advance = Math.max(1, Math.ceil((glyph.advanceWidth ?? options.font.unitsPerEm / 2) * scale));
    const path = glyph.getPath(0, 0, options.px);
    const bbox = path.getBoundingBox();
    const empty = !Number.isFinite(bbox.x1) || !Number.isFinite(bbox.y1) || bbox.x1 === bbox.x2 || bbox.y1 === bbox.y2;
    const xOffset = empty ? 0 : Math.floor(bbox.x1) - 1;
    const yOffset = empty ? 0 : Math.floor(bbox.y1) - 1;
    const width = empty ? 0 : Math.max(0, Math.ceil(bbox.x2) - xOffset + 1);
    const height = empty ? 0 : Math.max(0, Math.ceil(bbox.y2) - yOffset + 1);
    const dataOffset = unpackedAlpha.length;

    if (width > 0 && height > 0) {
      const contours = flattenPath(path.commands as OpenTypePathCommand[]);
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
          unpackedAlpha.push(Math.round((covered * 15) / (SUPERSAMPLE * SUPERSAMPLE)));
        }
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
    lineHeight,
    baseline,
    glyphs,
    alpha: packNibbles(unpackedAlpha),
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
