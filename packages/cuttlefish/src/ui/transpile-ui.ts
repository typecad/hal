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
import { resolveColor } from "./color.js";
import { resolveStyles } from "./style-resolver.js";
import { selectEngine } from "./select-engine.js";
import { measure, Box } from "./layout-engine.js";
import { lowerUIToCpp, LoweredUI } from "../ir/transformers/ui-lowering.js";
import { buildUIFontAssets } from "./font-assets.js";
import {
  clampInt16,
  cssOpacityToPercent,
  cssPx,
  KEYFRAME_PROP_BG,
  KEYFRAME_PROP_FG,
  KEYFRAME_PROP_OPACITY,
  KEYFRAME_PROP_SIZE,
  KEYFRAME_PROP_TRANSFORM,
  parseTransform,
  type KeyframeSetModel,
} from "./model.js";

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

  const keyframeSets: KeyframeSetModel[] = rawKeyframes.map((ks) => ({
    name: ks.name,
    stops: ks.stops.map((stop) => {
      let props = 0;
      if (stop.background) props |= KEYFRAME_PROP_BG;
      if (stop.color) props |= KEYFRAME_PROP_FG;
      if (stop.opacity) props |= KEYFRAME_PROP_OPACITY;
      if (stop.transform || stop.left || stop.top) props |= KEYFRAME_PROP_TRANSFORM;
      if (stop.width || stop.height) props |= KEYFRAME_PROP_SIZE;
      const transform = parseTransform(stop.transform);
      const x = transform.x + cssPx(stop.left);
      const y = transform.y + cssPx(stop.top);
      return {
        percent: stop.percent,
        props,
        bg: stop.background ? resolveColor(stop.background, opts.colorFormat) : 0,
        fg: stop.color ? resolveColor(stop.color, opts.colorFormat) : 0,
        opacity: stop.opacity ? cssOpacityToPercent(stop.opacity) : 100,
        transformOffsetX: clampInt16(x),
        transformOffsetY: clampInt16(y),
        translatePctX: clampInt16(transform.pctX),
        translatePctY: clampInt16(transform.pctY),
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        rotateDeg: clampInt16(transform.rotateDeg),
        width: stop.width ? Math.max(0, Math.min(32767, cssPx(stop.width))) : 0,
        height: stop.height ? Math.max(0, Math.min(32767, cssPx(stop.height))) : 0,
      };
    }),
  }));

  return lowerUIToCpp(styled, boxes, opts.colorFormat, opts.storage, [], rules, undefined, fontAssets, [], new Map(), keyframeSets);
}
