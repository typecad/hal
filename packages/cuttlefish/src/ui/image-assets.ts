// ---------------------------------------------------------------------------
// Image asset loader: reads raw RGB565 binary files for <img> nodes and keeps
// node ids mapped to the generated image table indices.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { StyledNode } from "./style-resolver.js";

export interface UIImageAsset {
  /** C++-safe unique id used for the generated data symbol. */
  id: string;
  /** Pixel width of the raw RGB565 asset. */
  width: number;
  /** Pixel height of the raw RGB565 asset. */
  height: number;
  /** RGB565 pixel data (width * height values, row-major). */
  data: number[];
}

export interface LoadedUIImageAssets {
  assets: UIImageAsset[];
  nodeIdToAssetIndex: Map<string, number>;
}

function sanitizeCppIdentifier(value: string, fallback: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  const base = sanitized.length > 0 ? sanitized : fallback;
  return /^[A-Za-z_]/.test(base) ? base : `img_${base}`;
}

function uniqueAssetId(preferred: string, index: number, used: Set<string>): string {
  const base = sanitizeCppIdentifier(preferred, `img_${index}`);
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

function imageNaturalWidth(node: StyledNode): number {
  const width = (node as any).imgWidth as number | undefined;
  return width && width > 0 ? width : 32;
}

function imageNaturalHeight(node: StyledNode): number {
  const height = (node as any).imgHeight as number | undefined;
  return height && height > 0 ? height : 32;
}

function imageAssetKey(src: string, htmlDir: string, width: number, height: number): string {
  const abs = path.isAbsolute(src) ? src : path.resolve(htmlDir, src);
  return `${abs}\0${width}\0${height}`;
}

export function loadImageAssets(roots: StyledNode | StyledNode[], htmlDir: string): LoadedUIImageAssets {
  const assets: UIImageAsset[] = [];
  const nodeIdToAssetIndex = new Map<string, number>();
  const keyToAssetIndex = new Map<string, number>();
  const usedIds = new Set<string>();

  const walk = (node: StyledNode) => {
    const src = (node as any).src as string | undefined;
    if (src && node.id) {
      const width = imageNaturalWidth(node);
      const height = imageNaturalHeight(node);
      const key = imageAssetKey(src, htmlDir, width, height);
      let assetIdx = keyToAssetIndex.get(key);
      if (assetIdx === undefined) {
        const assetId = uniqueAssetId(node.id, assets.length, usedIds);
        const asset = readRgb565Image(src, htmlDir, assetId, width, height);
        if (asset) {
          assetIdx = assets.length;
          assets.push(asset);
          keyToAssetIndex.set(key, assetIdx);
        }
      }
      if (assetIdx !== undefined) {
        nodeIdToAssetIndex.set(node.id, assetIdx);
      }
    }
    node.children.forEach(walk);
  };

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    walk(root);
  }

  return { assets, nodeIdToAssetIndex };
}

export function emitImageTables(assets: UIImageAsset[]): string {
  if (assets.length === 0) {
    return "const UIImage __ui_images[] = {};\nconst uint16_t __ui_image_count = 0;";
  }

  const lines: string[] = [];
  for (const asset of assets) {
    lines.push(`static const uint16_t __ui_img_${asset.id}_data[] = {`);
    for (let i = 0; i < asset.data.length; i += 16) {
      const chunk = asset.data
        .slice(i, i + 16)
        .map((v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0"));
      lines.push("  " + chunk.join(", ") + ",");
    }
    lines.push("};");
  }

  lines.push("const UIImage __ui_images[] = {");
  for (const asset of assets) {
    lines.push(`  { ${asset.width}, ${asset.height}, __ui_img_${asset.id}_data },`);
  }
  lines.push("};");
  lines.push(`const uint16_t __ui_image_count = ${assets.length};`);
  return lines.join("\n");
}

/** Read a raw RGB565 binary file and return a padded UIImageAsset. */
export function readRgb565Image(
  srcPath: string,
  htmlDir: string,
  id: string,
  width: number,
  height: number,
): UIImageAsset | null {
  const abs = path.isAbsolute(srcPath)
    ? srcPath
    : path.resolve(htmlDir, srcPath);

  if (!fs.existsSync(abs)) {
    console.warn(`[img] Image file not found: ${abs}`);
    return null;
  }

  const buf = fs.readFileSync(abs);
  const expectedPixels = width * height;
  const expectedBytes = expectedPixels * 2;
  if (buf.length < expectedBytes) {
    console.warn(`[img] Image ${srcPath} is ${buf.length} bytes, expected ${expectedBytes} (${width}x${height}x2). Padding missing pixels with 0.`);
  }

  const availablePixels = Math.min(expectedPixels, Math.floor(buf.length / 2));
  const data = new Array<number>(expectedPixels).fill(0);
  for (let i = 0; i < availablePixels; i++) {
    data[i] = buf.readUInt16LE(i * 2);
  }

  return { id, width, height, data };
}
