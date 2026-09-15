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

Out of scope per the design: band renderer / scroll canvases / OSK on 1bpp.
Raw display.* ops keep the direct-op runtime beneath the UI path.
