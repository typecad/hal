---
'@typecad/cuttlefish': minor
'@typecad/ui': minor
'@typecad/framework-zephyr': minor
---

Stage 2 — the mono (1bpp) display lowering target (DISPLAY-TARGETS.md)

Users author the SAME .ui files; the build flattens to 1bpp and the preview
shows exactly what the panel gets. The dirty/band/scroll-canvas machinery is
bypassed under the new UI_FULL_FRAME_REDRAW define — a 128×64 frame is 1KB,
composited whole in the panel's backing store and pushed as ONE display_write.

- Capabilities: any `colorFormat: "mono"` profile derives the mono lowering
  (no displayClass needed); OLED-class mono stays interactive (immediate
  refresh, scroll + keyframes on), e-ink keeps the deferred axis for Stage 4.
- Flattening rules with build-time warnings: colors → luminance threshold
  0/1, antialias off, border-radius → square, shadows/opacity dropped,
  gradients → first-stop fill, `:pressed` → face inversion (mono's native
  highlight; the :pressed color transitions are not emitted).
- Fonts: the shared subsetting pipeline packs 1bpp glyph bitmaps (8 px/byte,
  dataOffset in bits) — half the flash of the 4-bit alphas; the runtime's
  ui_font_alpha_at gains the mono format branch.
- Images: per-image threshold (the shared luminance rule) or
  `<img dither="floyd-steinberg">`, packed 1bpp at build; the preview renders
  the SAME baked bits.
- Zephyr mono UI adapter (ui-adapter-mono.ts): vtiled MONO01 backing store
  (the layout the ssd1306-class drivers require), mono scroll-viewport clip,
  MONO10 fallback via inverted pushes. The mono decline in the dispatch is
  gone; drop-in mono compatibles (solomon,ssd1306/ssd1309, sinowealth,sh1106)
  synthesize mono profiles.
- Fixed in Stage 1's direct-op path: the mono framebuffer now packs VTILED
  MONO01 with pitch == width — the old horizontal packing failed the
  ssd1306 driver's pitch check (-EINVAL) and never reached the panel.
  Registered profiles are now seeded into the display state (they weren't).
- Stage 2g: native_sim CI gate — the native-sim-mono profile rides the
  board's built-in sdl_dc (no generated display node, MONO01 format);
  demos/demo-mono-sim west-compiles the whole lowering on Linux runners.
  demos/demo-mono-oled west-compiles on esp32s3 (verified: ssd1306@3c node,
  CONFIG_SSD1306 + CONFIG_I2C self-build, zephyr.elf links).
- Rig path (demos/demo-mono-rig): drop-in `solomon,ssd1309` over I2C with
  `display.i2cPins { sda, scl }` — the overlay remuxes i2c0's pinctrl to the
  wired pins (mirroring the touch remux) and names the DT node from the
  compatible's panel segment. The drop-in mono dispatch now routes the 1bpp
  adapter (it previously fell through to the rgb565 display-API adapter).
  The demo self-drives from Time-based bindings (uptime, sweeping progress,
  a 1 Hz :pressed face-inversion toggle) — no input wiring needed.
- Engine fixes the rig demo surfaced: Math.* calls in ui.bind callbacks now
  pull the math header (the include scan never saw binding-table bodies),
  and Math.* method/call expressions infer as double so the renderer's
  modulo→fmod promotion fires (`Math.floor(x) % n` used to emit
  `double % int`). Known remaining gap: TEXT bindings prerender outside the
  renderer, so modulo on doubles inside a text template still needs a
  node-value read (see the demo's sweepPct).
- Hardware-verified fixes (SSD1309 rig): `:root` styling declarations now
  apply to the screen root — parseCss previously kept only the custom
  properties and silently dropped authored root backgrounds/colors, so the
  UA's light screen defaults won the cascade and the panel rendered with a
  fully-lit background (which read as white lines flanking the pressed
  rect's border). The mono glyph bake threshold drops from 50% to ~31%
  coverage (MONO_ALPHA_THRESHOLD 8→5): thin strokes of a 10px bold face sit
  under 50% coverage and dropped out, leaving ragged anti-alias-looking
  edges; 5 keeps strokes connected without over-bolding (both the panel and
  the preview render the same baked bits).
- Mono light hinting: the 1bpp bake now snaps stems onto the pixel grid (a
  simplified FreeType-autohinter mono pass — near-vertical/horizontal edge
  runs, stem pairing, integer-width snapping, interpolated point shifts),
  plus a conservative despeckle/hole-fill finishing pass that exempts
  tiny-mark glyphs (a middot at 10px is legitimately one pixel). A 1.4px
  stem renders one constant integer width instead of wobbling between 1
  and 2 pixels along its length; stems share phase across glyphs because
  every edge snaps to the same integer lattice. The alpha4 (color display)
  bake stays on the raw outline, byte-identical.
- Built-in Classic bitmap family: `font-family: "Classic"` (no @font-face)
  bakes from the shared glcdfont 5x7 table — native 8px pixels as designed,
  and at 16px the Technoblogy diagonal-corner smoothing ("Smooth Big Text",
  David Johnson-Davies): the two sub-pixels at every one-row diagonal
  step's inner corner are bridged, so doubled staircases read as connected
  45° runs between integer-width stems. Sizes quantize to whole cells
  (floor(px/8), min 1); other scales double cleanly without smoothing.
  Works for mono1 and alpha4 targets alike. Possible follow-up: the
  article's per-glyph hint pixels for the few junction kinks the automatic
  rule leaves (source-level gaps in glyphs like '4').

Out of scope per the design: band renderer / scroll canvases / OSK on 1bpp.
Raw display.* ops keep the direct-op runtime beneath the UI path.
