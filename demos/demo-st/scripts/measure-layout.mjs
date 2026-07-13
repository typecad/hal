#!/usr/bin/env node
// measure-layout.mjs — print the laid-out boxes of demo-st's showcase.ui.
//
// Usage: node scripts/measure-layout.mjs
//
// Reads demo-st/src/showcase.ui, runs it through the cuttlefish layout engine
// at the configured viewport, and prints every node's box + the full-width
// row summary. Use this BEFORE flashing to verify a layout change fits the
// screen — turns "guess and eyeball hardware" into "measure and verify".
//
// Requires a built cuttlefish dist:
//   npm run build --workspace @typecad/cuttlefish

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const dist = path.join(root, "packages/cuttlefish/dist");

// cuttlefish ships ESM (.js with "type":"module"); dynamic import on Windows
// requires a file:// URL (a bare path throws ERR_UNSUPPORTED_ESM_URL_SCHEME).
const importDist = (rel) => import(pathToFileURL(path.join(dist, rel)).href);

const { loadUIModuleFromText, lowerOnMount } = await importDist("ui/ui-registry.js");
const { splitUiFile } = await importDist("ui/ui-file-splitter.js");

// Viewport: ST7796 profile rotation=1 → effective 480x320 landscape.
const VIEWPORT = { width: 480, height: 320 };

const uiPath = path.resolve(__dirname, "..", "src", "showcase.ui");
const src = fs.readFileSync(uiPath, "utf-8");
const parts = splitUiFile(src);
const htmlPath = uiPath + ".html";
loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
const lowered = lowerOnMount(htmlPath, {
  colorFormat: "rgb565",
  storage: "flash",
  viewport: VIEWPORT,
});

// Print every node's box.
console.log(`=== ${path.basename(uiPath)} at ${VIEWPORT.width}x${VIEWPORT.height} ===\n`);
const lines = lowered.nodeTable.split("\n");
let maxBottom = 0;
lines.forEach((ln, i) => {
  const box = ln.match(/\.box=\{(\d+),(\d+),(\d+),(\d+)\}/);
  const kind = ln.match(/\.kind=(NODE_\w+)/)?.[1];
  const text = ln.match(/\.text="([^"]*)"/)?.[1];
  if (box && kind) {
    const [, x, y, w, h] = box.map(Number);
    maxBottom = Math.max(maxBottom, y + h);
    console.log(`n${i} ${kind.padEnd(14)} ${(text ?? "").padEnd(24)} x=${x} y=${y} w=${w} h=${h}`);
  }
});

console.log(`\n=== summary ===`);
console.log(`lowest node bottom: ${maxBottom} (viewport ${VIEWPORT.height})`);
console.log(`overflow: ${maxBottom > VIEWPORT.height ? `+${maxBottom - VIEWPORT.height}px (CLIPPED)` : "fits"}`);

// Surface any layout diagnostics.
const layoutDiags = (lowered.diagnostics ?? []).filter(
  d => d.code === "layout-viewport-overflow" || d.code === "layout-text-overflow",
);
if (layoutDiags.length > 0) {
  console.log(`\n=== diagnostics ===`);
  for (const d of layoutDiags) console.log(`${d.code}: ${d.message}`);
} else {
  console.log(`\n=== diagnostics ===\nnone`);
}
