# Display Lowering Targets — design decisions (Stages 2–4)

The UI API is target-independent. Each display class is a lowering target
defined by three parameters: **pixel format × refresh model × frame budget**.
Displays declare what they are; the build lowers accordingly. This file
records the agreed design so implementation doesn't re-litigate it.

Status: Stage 1 shipped (SSD I²C direct ops, commit history in git).
Stage 2 shipped (mono lowering — full-frame adapter, flattening rules with
build warnings, 1bpp fonts/images, native_sim CI gate; demos/demo-mono-oled
west-compiles on esp32s3, demos/demo-mono-sim is the CI target). Hardware-
verified through the SSD1309 rig and the font-size ladder
(demos/demo-font-sizes). Font rendering final form: **TrueType hinting
executes on the mono bake** (opentype.js 2.0 interpreter; the geometric
fallback stack — stem snapping + coalescing + despeckle — covers
uninstructed fonts; zones/corner-bridge toggles currently OFF), pair
kerning baked per face, threshold 5 (4 at <=10px). Panel-established size
floor: 10px legible, 13px comfortable. Display i2c buses declare 400kHz
fast mode (the 1KB full-frame push is bandwidth-bound). Per-node text
background clears are skipped under UI_FULL_FRAME_REDRAW (they erased
sibling descenders and were redundant — full-frame repaints in z order).
Golden glyph bitmaps pinned in tests/packages/ui/golden-mono-glyphs.test.ts.
Stage 3 shipped UNTESTED ON HARDWARE (gray8: UI_COLOR_T uint8_t + ui_blend8/
lerp_color_8, AA + opacity return, gradients still flatten, keyframes elided;
drop-in solomon,ssd1327; demos/demo-gray compile-verified on esp32s3 + preview-
verified ~100 gray levels — awaiting an SSD1327 module; panel tuning props are
the oscillator-freq/remap-value/phase-length knobs). Stage 4 e-ink.

## Stage 2 — mono (same UI API, flattened)

Contract: users author the SAME .ui files / ui API; colors flatten to 1bpp
at build time. "They get what they get" — and the PREVIEW shows exactly
that (the flattening rules render in the browser before flashing).

Decisions:
- **Full-frame redraw, always.** A 128×64 panel is 1KB (~25ms over I²C) —
  incremental compositing has nothing to optimize. The retained node table,
  bindings, signals, and frame tick stay; the dirty/band/scroll-canvas
  machinery is BYPASSED for mono, not ported. Scroll still works because
  every frame is a full repaint.
- **Pixel-format seam (2a)**: UI_COLOR_T/depth becomes a target parameter
  (1/4/16bpp packers). CuttlefishCanvasMono + the UI_NATIVE_MONO /
  UI_REQUIRES_BACKING_STORE / UI_REFRESH_DEFERRED defines already shipped in
  the runtime header — the seam was placed for this.
- **Flattening rules (2c)**: colors → luminance threshold 0/1; antialias
  off; border-radius → square; shadows/opacity dropped; gradients → warning
  + first-stop fill; `:pressed` → **invert** (mono's native highlight).
  Build-time WARNINGS for degenerately flattened constructs.
- **Fonts (2d)**: the shared build-time subsetting pipeline retargeted to
  1bpp glyph bitmaps (also replaces the direct-op path's 5×7 digits-only
  table). **Images (2e)**: per-image threshold or Floyd–Steinberg at build,
  1bpp packed.
- **Verification (2g)**: the `native_sim` SDL target (`zephyr,sdl-dc`
  binding) runs the whole mono lowering in CI with no hardware — the
  standing no-hardware gate for both mono and color.
- Runtime-header byte-identity tests gain mono-variant snapshots.

Out of scope for mono: porting the band renderer, scroll canvases, or the
OSK to 1bpp. Raw `display.*` ops remain available beneath the UI path.

## Stage 3 — grayscale (prove the seam)

4bpp packer + luminance RAMP (not threshold — antialiasing partially
returns), dithered images, transitions ELIDED (8KB frames ≈ 200ms → ~5fps,
animation dies by lowering decision). Preview gains a gray mode. Days, not
weeks, if Stage 2's seam is honest.

## Stage 4 — e-ink (refresh-model proof)

Same 1bpp format as mono; the new axis is refresh: deferred-full, 1–4s
per refresh with the panel's flash cycle. **Render on signal change, flush,
panel sleeps** — the zero-power static display is the feature. Transitions
deleted outright (RefreshModel: deferred ⇒ no keyframe emission). Tri-color
panels = palette lowering (nearest ink; the NativeFormat palette slot).
Prereq: overlay family branch for ssd16xx/uc8176 bindings (SPI + busy-gpios)
— same pattern as the SSD I²C work.

## The orthogonality proof

Mono OLED and e-ink share the identical pixel format yet sit at opposite
ends of behavior (25ms interactive frames vs. seconds, event-driven) —
format and refresh are independent axes; both must be target parameters.

## Panel quirks (config flags, not code)

`rgbInverted` (565 wire byte order), `csHold` (CS-held mipi-dbi host),
`channelSwapRb` (pack-time R/B swap), `rotation` (MADCTL table), touch
`resetPin` (power enable). A verified set — compatible + geometry + flags +
touch wiring — is a shareable **panel card**.
