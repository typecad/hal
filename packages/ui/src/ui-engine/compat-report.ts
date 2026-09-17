// ---------------------------------------------------------------------------
// CSS compatibility report — post-layout diagnostics that make the engine's
// divergences from browser behavior VISIBLE instead of silent.
//
// Every check here corresponds to a place where the engine approximates or
// quantizes what a browser would do (font-size bucketing on the stock font,
// ignored alpha, display-anchored UA scale, touch-target minimums). Surfaces
// as ordinary warnings in the build output; `--strict-css` upgrades them to
// errors (see the cuttlefish CLI).
// ---------------------------------------------------------------------------

import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import type { StyledNode } from "./style-resolver.js";
import type { Box } from "./layout-engine.js";
import type { UIFontAssetModel } from "./font-assets.js";
import { selectFontAssetForStyle } from "./font-assets.js";
import { hasIgnoredAlpha } from "./color.js";
import { uaScaleFor } from "./ua-stylesheet.js";
import { getDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

const COLOR_PROPS = [
  "color", "background", "borderColor", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "outline",
] as const;

/** Stock-font size buckets (model.ts textSizeOf): every font-size in a bucket
 *  renders at the same pixel size when no @font-face matches. */
function bucketOf(px: number): string {
  if (px <= 12) return "1–12";
  if (px <= 20) return "13–20";
  if (px <= 28) return "21–28";
  return "29+";
}

function labelOf(node: StyledNode): string {
  if (node.id) return `#${node.id}`;
  if (node.origTag) return `<${node.origTag}>`;
  return `<${node.tag}>`;
}

/** Produce CSS-compatibility diagnostics for the lowered tree. */
export function cssCompatDiagnostics(
  screens: StyledNode[],
  fontAssets: UIFontAssetModel[],
  viewport: { width: number; height: number },
  colorFormat: string | undefined,
  sourceFile: string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const push = (key: string, d: Diagnostic): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };

  const mono = colorFormat === "mono";
  const scale = uaScaleFor(viewport.height, mono);

  // Surface the display-anchored UA scale once when it differs from the
  // browser's classic 16px — "why is my text smaller than on desktop" answered
  // up front instead of discovered pixel-by-pixel.
  if (scale.root !== 16 || mono) {
    out.push({
      severity: "info",
      code: "css-ua-scale",
      message: `Display-anchored UA defaults active: root text ${scale.root}px` +
        (mono ? ` (monochrome; stock-font sizes are bucketed 1–12/13–20/21–28/29+)` : ``) +
        `, headings ${scale.h.join("/")}, touch-target min-height ${scale.controlMinHeight}px.`,
      hint: `Override per element with explicit px font-sizes, or restyle the scale in your own CSS.`,
      source: sourceFile,
    });
  }

  const walk = (node: StyledNode): void => {
    const style = node.style as Record<string, string | undefined>;
    const label = labelOf(node);

    // Interactive widgets on a touchless target: lists and selects are
    // interaction surfaces (drag-scroll, dropdown tap) — with no touch
    // controller wired they render but can never be used. GPIO buttons can
    // still drive page flips and dialogs; these two widgets cannot.
    if (node.tag === "list" || node.tag === "select") {
      let noTouch = false;
      try { noTouch = !(getDisplayProfile() as { touch?: unknown }).touch; } catch { /* unbound */ }
      if (noTouch) {
        push(`no-touch:${label}:${node.tag}`, {
          severity: "warning",
          code: "ui-interactive-no-touch",
          message: `${label}: <${node.tag}> is an interaction widget, but this target has no touch controller wired — it renders but cannot be used.`,
          hint: `Use bound text readouts for display-only panels, or wire touch (config display.touch) / drive content via ui.watchPin instead.`,
          source: sourceFile,
        });
      }
    }

    // Partial alpha is silently dropped (no blending on bare metal).
    for (const prop of COLOR_PROPS) {
      const v = style[prop];
      if (v && hasIgnoredAlpha(v)) {
        push(`alpha:${v}`, {
          severity: "warning",
          code: "css-alpha-ignored",
          message: `${label}: alpha in "${v}" is ignored — the color renders fully opaque (${prop}).`,
          hint: `There is no alpha blending on bare metal; blend against the target background color instead.`,
          source: sourceFile,
        });
      }
    }

    // font-size sanity against the viewport and the stock-font buckets.
    const fs = style.fontSize;
    if (fs) {
      const px = parseFloat(fs);
      if (Number.isFinite(px) && px > 0) {
        if (px >= viewport.height * 0.15) {
          push(`fsvp:${px}`, {
            severity: "warning",
            code: "css-font-size-viewport",
            message: `${label}: font-size ${px}px is ${Math.round((px / viewport.height) * 100)}% of the ${viewport.height}px display height.`,
            hint: `Large fills of a small screen are sometimes intended — if not, scale it down.`,
            source: sourceFile,
          });
        }
        // Quantization only bites on the stock font (no matching @font-face).
        if (mono && selectFontAssetForStyle(fontAssets, node.style) === undefined) {
          push(`bucket:${px}`, {
            severity: "warning",
            code: "css-font-size-quantized",
            message: `${label}: font-size ${px}px renders at the stock-font bucket for ${bucketOf(px)}px — every size in that range draws identically on monochrome displays.`,
            hint: `Pick sizes from the bucket edges (12/20/28) or register an @font-face for exact sizes.`,
            source: sourceFile,
          });
        }
        // Sub-floor sizes on mono: below ~10px DejaVu's features (counters,
        // thin diagonals) collide with the 1bpp pixel grid no matter how the
        // outline is hinted — the size-ladder panel trials established 10px
        // as the smallest generally-legible size and 13px the comfortable one.
        if (mono && px < 10) {
          push(`mono-tiny:${px}`, {
            severity: "warning",
            code: "css-mono-font-size-floor",
            message: `${label}: font-size ${px}px is below the 1bpp legibility floor (10px) — glyph features will drop out.`,
            hint: `Use 10px minimum for captions, 13px+ for body text on monochrome displays.`,
            source: sourceFile,
          });
        }
      }
    }

    // Mono flattening warnings (Stage 2): each construct the mono lowering
    // degenerately flattens gets a warning so "they get what they get" is at
    // least announced. The preview renders the same flattening, so what the
    // author sees in the browser matches the panel.
    if (mono) {
      const shadow = style.boxShadow;
      if (shadow && shadow !== "none") {
        push(`mono-shadow:${label}:${shadow}`, {
          severity: "warning",
          code: "css-mono-shadow-dropped",
          message: `${label}: box-shadow is dropped on monochrome displays ("${shadow}").`,
          hint: `1bpp has no alpha to render a shadow; remove it or accept the flat look.`,
          source: sourceFile,
        });
      }
      const textShadow = style.textShadow;
      if (textShadow && textShadow !== "none") {
        push(`mono-tshadow:${label}:${textShadow}`, {
          severity: "warning",
          code: "css-mono-shadow-dropped",
          message: `${label}: text-shadow is dropped on monochrome displays ("${textShadow}").`,
          hint: `1bpp has no alpha to render a shadow.`,
          source: sourceFile,
        });
      }
      const bg = style.background;
      if (bg && bg.includes("linear-gradient")) {
        push(`mono-gradient:${label}:${bg}`, {
          severity: "warning",
          code: "css-mono-gradient-flattened",
          message: `${label}: linear-gradient flattens to its first color stop on monochrome displays.`,
          hint: `Pick a solid background, or make the first stop the color you want shown.`,
          source: sourceFile,
        });
      }
      const op = style.opacity;
      if (op) {
        const n = Number.parseFloat(op);
        if (Number.isFinite(n) && n < 1) {
          push(`mono-opacity:${label}:${op}`, {
            severity: "warning",
            code: "css-mono-opacity-dropped",
            message: `${label}: opacity ${op} is dropped on monochrome displays — the element renders fully opaque.`,
            hint: `1bpp has no blending; show/hide or restyle the element instead.`,
            source: sourceFile,
          });
        }
      }
      const radius = style.borderRadius;
      if (radius) {
        const px = parseFloat(radius);
        if (Number.isFinite(px) && px > 0) {
          push(`mono-radius:${label}:${radius}`, {
            severity: "warning",
            code: "css-mono-radius-squared",
            message: `${label}: border-radius ${radius} flattens to square corners on monochrome displays.`,
            hint: `1bpp corner arcs render as stair-steps; squares are the honest flattening.`,
            source: sourceFile,
          });
        }
      }
    }

    // Touch-target minimums that swallow half the screen.
    const mh = style.minHeight;
    if (mh) {
      const px = parseFloat(mh);
      if (Number.isFinite(px) && px >= viewport.height * 0.5) {
        push(`mhvp:${px}`, {
          severity: "warning",
          code: "css-min-height-viewport",
          message: `${label}: min-height ${px}px is ${Math.round((px / viewport.height) * 100)}% of the ${viewport.height}px display height.`,
          hint: `Reduce the min-height for very small panels (the UA default already scales down).`,
          source: sourceFile,
        });
      }
    }

    for (const child of node.children) walk(child);
  };
  for (const screen of screens) walk(screen);

  return out;
}
