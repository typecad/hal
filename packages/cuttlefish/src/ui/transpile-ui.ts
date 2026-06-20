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

import { parseHtml } from "./html-parser";
import { parseCss } from "./css-parser";
import { resolveStyles } from "./style-resolver";
import { BlockLayoutEngine } from "./block-layout";
import { measure, Box } from "./layout-engine";
import { lowerUIToCpp, LoweredUI } from "../ir/transformers/ui-lowering";

export interface TranspileUIOptions {
  colorFormat: "rgb565" | "mono";
  storage: "progmem" | "flash";
  viewport: { width: number; height: number };
}

export function transpileUI(html: string, css: string, opts: TranspileUIOptions): LoweredUI {
  const tree = parseHtml(html);
  const rules = parseCss(css);
  const styled = resolveStyles(tree, rules);

  // v1: block layout always. v2 will select on display:flex.
  const engine = new BlockLayoutEngine();
  const viewport: Box = { x: 0, y: 0, w: opts.viewport.width, h: opts.viewport.height };
  const boxes = engine.arrange(styled, viewport, measure);

  return lowerUIToCpp(styled, boxes, opts.colorFormat, opts.storage);
}
