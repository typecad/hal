// ---------------------------------------------------------------------------
// Image asset loader: reads raw RGB565 binary files and converts to number[]
// for embedding as C++ uint16_t arrays.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { StyledNode } from "./style-resolver.js";

export interface UIImageAsset {
  /** Unique id (from the <img id="..."> attribute). */
  id: string;
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
  /** RGB565 pixel data (width × height values, row-major). */
  data: number[];
}

/**
 * Walk the styled tree, find all <img> nodes, read their .img files,
 * and return image assets. The htmlDir is used to resolve relative paths.
 */
export function loadImageAssets(root: StyledNode, htmlDir: string): UIImageAsset[] {
  const assets: UIImageAsset[] = [];
  const seen = new Set<string>();

  const walk = (node: StyledNode) => {
    const src = (node as any).src as string | undefined;
    if (src && !seen.has(src)) {
      seen.add(src);
      const width = (node as any).imgWidth as number | undefined;
      const height = (node as any).imgHeight as number | undefined;
      const id = node.id ?? `img_${assets.length}`;
      const asset = readRgb565Image(src, htmlDir, id, width ?? 32, height ?? 32);
      if (asset) assets.push(asset);
    }
    node.children?.forEach(walk);
  };

  // Walk all screens if available, otherwise just the root.
  walk(root);
  return assets;
}

/** Read a raw RGB565 binary file and return as a UIImageAsset. */
function readRgb565Image(
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
  const expectedBytes = width * height * 2;
  if (buf.length < expectedBytes) {
    console.warn(`[img] Image ${srcPath} is ${buf.length} bytes, expected ${expectedBytes} (${width}x${height}x2).`);
  }

  // Read as little-endian uint16 pairs.
  const pixelCount = Math.min(width * height, Math.floor(buf.length / 2));
  const data: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    data.push(buf.readUInt16LE(i * 2));
  }

  return { id, width, height, data };
}
