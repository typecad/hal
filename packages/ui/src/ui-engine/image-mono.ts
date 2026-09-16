// Browser-safe mono image leaf — NO node imports. The preview's host runtime
// loads in the browser through dist; image-assets.ts (the bake-time module
// this logic used to live in) imports node:fs/node:path, which kills the
// browser module graph. The bake re-exports from here so emission and the
// preview keep sharing one implementation.

export type MonoImageMode = "threshold" | "floyd-steinberg";

/** Flatten RGB565 pixel data to a packed 1bpp bit stream (MSB-first,
 *  continuous across rows — the runtime's ui_image_pixel indexes it as
 *  data[(y*w+x) >> 3] & 0x80>>((y*w+x)&7)). Threshold mode uses the SAME
 *  luminance rule as the color flattening (299r+587g+114b >= 68850 —
 *  ui_snap_mono565); Floyd–Steinberg diffuses that error for photos.
 *  Shared by the C++ table emission and the preview so both show identical
 *  pixels. */
export function monoImageBits(asset: { width: number; height: number; data: number[] }, mode: MonoImageMode): number[] {
  const w = asset.width;
  const h = asset.height;
  const n = w * h;
  // Integer luminance domain: 299r+587g+114b, 0..255000 per pixel.
  const lum = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const v = asset.data[i] ?? 0;
    const r5 = (v >> 11) & 0x1f;
    const g6 = (v >> 5) & 0x3f;
    const b5 = v & 0x1f;
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g6 << 2) | (g6 >> 4);
    const b = (b5 << 3) | (b5 >> 2);
    lum[i] = 299 * r + 587 * g + 114 * b;
  }
  const WHITE = 255000;
  const on = new Uint8Array(n);
  if (mode === "floyd-steinberg") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const old = lum[i];
        const lit = old >= 68850;
        on[i] = lit ? 1 : 0;
        const err = old - (lit ? WHITE : 0);
        if (x + 1 < w) lum[i + 1] += (err * 7) >> 4;
        if (y + 1 < h) {
          if (x > 0) lum[i + w - 1] += (err * 3) >> 4;
          lum[i + w] += (err * 5) >> 4;
          if (x + 1 < w) lum[i + w + 1] += err >> 4;
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) on[i] = lum[i] >= 68850 ? 1 : 0;
  }
  // Pack MSB-first, continuous stream.
  const out: number[] = [];
  let byte = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    byte = (byte << 1) | on[i];
    k++;
    if (k === 8) {
      out.push(byte);
      byte = 0;
      k = 0;
    }
  }
  if (k > 0) out.push(byte << (8 - k));
  return out;
}
