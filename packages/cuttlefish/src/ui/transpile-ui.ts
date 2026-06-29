// ---------------------------------------------------------------------------
// transpileUI — end-to-end facade: HTML + CSS → lowered C++.
//
// Orchestrates: parse HTML → parse CSS → resolve styles → layout → lower.
// This is the integration contract used by the AST visitor that resolves
// .ui.html imports during a normal `typehal build`.
//
// Selecting the layout engine on the `display` property happens here in v2;
// v1 always uses BlockLayoutEngine.
// ---------------------------------------------------------------------------

import path from "node:path";
import { parseHtml } from "./html-parser.js";
import { parseCss, parseFontFaces, parseKeyframes } from "./css-parser.js";
import { resolveStyles } from "./style-resolver.js";
import { selectEngine } from "./select-engine.js";
import { measure, Box } from "./layout-engine.js";
import { lowerUIToCpp, LoweredUI } from "../ir/transformers/ui-lowering.js";
import { buildUIFontAssets } from "./font-assets.js";
import { buildKeyframeSets } from "./keyframes.js";

export interface TranspileUIOptions {
  colorFormat: "rgb565" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
  assetBaseDir?: string;
}

export function transpileUI(html: string, css: string, opts: TranspileUIOptions): LoweredUI {
  const tree = parseHtml(html);
  const rules = parseCss(css);
  const fontFaces = parseFontFaces(css);
  const rawKeyframes = parseKeyframes(css);
  const styled = resolveStyles(tree, rules);
  const fontAssets = buildUIFontAssets(styled, fontFaces, path.resolve(opts.assetBaseDir ?? process.cwd()));

  // Select layout engine: Yoga for flexbox, BlockLayout as fallback.
  const engine = selectEngine(styled);
  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };
  const boxes = engine.arrange(styled, viewport, measure);

  const keyframeSets = buildKeyframeSets(rawKeyframes, opts.colorFormat);

  return lowerUIToCpp(styled, boxes, opts.colorFormat, opts.storage, [], rules, undefined, fontAssets, [], new Map(), keyframeSets);
}
