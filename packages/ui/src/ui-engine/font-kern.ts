// Browser-safe kerning leaf — NO node imports. The preview's host runtime
// loads in the browser through dist, and the bake-time font-assets module it
// used to source these from imports node:fs (the value import broke the
// whole browser module graph — black preview canvas). Types and the pair
// lookup live here; the bake (font-assets.ts) re-exports them.

/** A baked kerning pair: subset-local glyph indices (into the asset's glyphs
 *  array) and the pair's horizontal adjustment in whole pixels. Sorted by
 *  (l, r) so the runtime binary-searches. */
export interface UIFontKernPair {
  l: number;
  r: number;
  v: number;
}

/** Kerning adjustment (whole pixels) between two glyphs of an asset, by
 *  subset-local index. Mirrors the runtime's binary search over the same
 *  (l, r)-sorted pairs. Returns 0 when the face carries no pair table. */
export function kernPairValue(
  asset: { kern?: UIFontKernPair[] },
  l: number,
  r: number,
): number {
  const kern = asset.kern;
  if (!kern || kern.length === 0 || l < 0 || r < 0) return 0;
  let lo = 0;
  let hi = kern.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = kern[mid]!;
    if (k.l === l && k.r === r) return k.v;
    if (k.l < l || (k.l === l && k.r < r)) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}
