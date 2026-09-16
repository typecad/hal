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
- Pair kerning baked from opentype.js (the existing dependency — no new
  packages): each face carries its subset's non-zero kern pairs (GPOS
  lookups via getKerningValue, with the legacy `kern` table as fallback
  because opentype.js never falls back itself when GPOS tables exist —
  DejaVu ships both). The runtime applies the pair at the draw cursor via
  a binary-searched UIFontKern table; ui_asset_text_width, span widths,
  layout measurement (assetTextWidth), and the preview draw/width paths
  all mirror it, so wrapping and centering measure what drawing renders.
  Works for color and mono targets alike.
- Mono blue zones: the light hinting now derives the face's shared design
  heights (baseline, x-height, cap-height — OS/2 sxHeight/sCapHeight when
  present, 'x'/'H' glyph metrics otherwise; DejaVu ships an older OS/2) and
  snaps horizontal edges within 0.35px of a zone to the zone's integer row
  instead of their own rounding, so glyph-to-glyph drift that crosses an
  integer boundary no longer puts one letter's x-height a row off. Paired
  bars at a zone shift whole, preserving integer stem widths.
- Variable-weight bakes — investigated, deliberately not shipped yet:
  opentype.js ^2 supports everything needed (glyph.getPath accepts
  { variation: { wght } }, and font.variation.getTransform updates
  advanceWidth from HVAR), but the repo bundles only static faces, so the
  plan-key/CSS-weight-range semantics would land unverified. The verified
  recipe when a variable TTF arrives: detect font.tables.fvar, clamp the
  requested weight into the wght axis, pass variation coords to getPath,
  read the advance from the transformed glyph, and key the parsed-font
  cache by (path, weight) since getTransform mutates glyph.advanceWidth.
- Panel-verified fixes from the SSD1309 rig photo: (1) stem pairing could
  pair the two edges of a COUNTER (an R bowl's top and bottom bars, an o's
  inner walls) because they are adjacent with overlapping extents — snapping
  them shut sheared the R's diagonal leg into a P and squashed the 9's
  bowl. Pairs now require INK between the edges (a point-in-glyph probe at
  the midpoint of the overlap), so only true strokes snap. (2) The mono
  face subset carried only the static text's glyphs — script-level
  ui.bind(..., 'text') targets are invisible at planning time, so bound
  values drew with gaps ("t=12.5s" rendered "t=1 s"). Mono faces now widen
  to the fallback charset unconditionally (~0.7KB mono1 bits; color targets
  keep the precise per-node widening).
- Hinting deformation guard + the size floor: snapping a stroke to an
  integer width deforms it by |round(gap) - gap| and squeezes the curves
  attached to it — pairs needing more than 0.3px of deformation now keep
  their designed width (the d/m bowls thinned below the draw threshold
  before this). And the rig demo moves to 12px text in four 16px rows:
  10px is this face's resolution floor (stems ~0.95px, features collide
  with the threshold); at 12px stems quantize to 1px cleanly, counters
  open, and every previously-damaged glyph renders complete. The demo
  drops the fifth (#alt) line — its bound-text coverage duplicates
  sweepPct's — and shortens the title to "SSD1309 · MONO" (the full
  string overflows 122px at 12px).
- Stroke-consistency + smoothness round: (1) collinear edge fragments now
  MERGE before pairing — a stem's edge splits where a curve junction breaks
  the run, and the interleaved fragment blocked the stem's true partner in
  sorted-adjacent pairing, leaving h/n/L/T/f walls unsnapped (a 1.1px stem
  at the wrong phase renders 2px next to snapped 1px neighbors). (2) The
  deformation cap rises 0.3 → 0.4px so genuinely-wide stems (DejaVu's '1'
  at 1.64px) snap cleanly to 2px instead of rendering ragged raw. Cap stems
  are heavier than lowercase BY DESIGN in this face — 2px caps against 1px
  lowercase is correct optical weight, not inconsistency. (3) The
  Technoblogy corner-bridge transposed to native scale: a diagonal
  staircase step (ink at (x,y) and (x+1,y±1), both notch cells empty)
  fills the notch cell with more surrounding ink, turning disconnected
  staircases into 8-connected 45-degree runs. (4) 9px is the available
  small size (bake-verified: digits and lowercase complete, counters
  open; 8px is this face's floor) — the rig demo's percentage readout
  uses it.
- Fixed the browser preview (black canvas): the preview's host runtime
  loads in the browser through dist, and its value imports from the
  bake-time font-assets/image-assets modules — which carry node:fs —
  killed the entire module graph (type-only imports had been safe;
  kerning and mono-image preview support turned them into runtime
  imports). The browser-safe pieces now live in leaf modules with zero
  node imports (font-kern.ts, image-mono.ts), re-exported for the bake,
  and a graph-walking test guards the dist import graph against node
  builtins forever. The preview snapshot builder also now binds the
  display profile before baking fonts (matching the CLI transpile path)
  so mono panels bake mono1 faces in the browser too, instead of an AA
  rgb565 approximation; and mono drop-in demos declare colorFormat:
  'mono' explicitly in their config — the preview server has no
  framework strategy to infer it from the driver.
- The preview's script sandbox gains a Time shim: scripts import
  { Time } from '@typecad/hal' and call Time.now() in ui.bind callbacks
  (the device lowers that to the uptime clock), but the preview evaluates
  the authored expression verbatim — every timing binding threw
  "Time is not defined" once per tick, spamming the diagnostics panel.
  Time.now()/nowUs() now follow the runtime's simulated clock (advances
  by each tick's delta — deterministic under explicit deltas), and
  sleep/busyWaitUs resolve immediately (the preview cannot block).

Out of scope per the design: band renderer / scroll canvases / OSK on 1bpp.
Raw display.* ops keep the direct-op runtime beneath the UI path.
