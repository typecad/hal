// ---------------------------------------------------------------------------
// Color resolution — hex (#rrggbb) → target color format
//
// Resolved ONCE at transpile time against the framework's colorFormat(), so the
// device never performs color conversion.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number; }

export function parseHexColor(hex: string): RGB {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`Invalid hex color "${hex}" — expected #rrggbb`);
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

export function toRGB565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export function toMono(r: number, g: number, b: number): 0 | 1 {
  // Relative luminance. Threshold at 0.27: a fully-saturated red primary
  // (255,0,0 → luminance 0.299) reads as "on" — relevant for the PoC's
  // red-text-on-black demo — while dark gray (64,64,64 → luminance 0.251)
  // and blue (0.114) stay off. Green (0.587) and white (1.0) are on.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum >= 0.27 ? 1 : 0;
}

export function resolveColor(hex: string, format: "rgb565" | "mono"): number {
  const { r, g, b } = parseHexColor(hex);
  return format === "rgb565" ? toRGB565(r, g, b) : toMono(r, g, b);
}
