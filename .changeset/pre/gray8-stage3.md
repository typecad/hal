---
'@typecad/cuttlefish': minor
'@typecad/ui': minor
'@typecad/framework-zephyr': minor
---

Stage 3 — grayscale (gray8) lowering target (DISPLAY-TARGETS.md)

The same UI API now lowers to 8-bit luminance for 16-gray OLED panels
(SSD1327-class): colors resolve to Rec.601 luminance bytes, the preview
renders the exact gray ramp the panel gets, and the full-frame push rides
one display_write of an L_8 framebuffer.

- Pixel-format seam proven: UI_COLOR_T switches to uint8_t with a gray
  blend (ui_blend8) and lerp (lerp_color_8); UI_COLOR_DEPTH 8;
  UI_NATIVE_GRAY8 gates the shared full-frame paths (scroll clipping,
  canvas absorbing overloads, per-pixel image draws) while color targets
  stay byte-identical.
- Antialiasing and opacity blending RETURN on gray8 (the luminance ramp
  replaces mono's 1bpp threshold); fonts keep their alpha4 nibble
  bitmaps; gradients still flatten to the first-stop gray; keyframe
  animation stays elided (an 8-16KB frame at I2C fast mode is
  ~50-100ms — animation dies by lowering decision, per the design).
- Zephyr: the solomon,ssd1327 driver accepts PIXEL_FORMAT_L_8 (it
  nibble-reduces to the panel's 16 levels) — the gray adapter keeps a
  row-major L_8 backing store and pushes the whole frame; drop-in
  configs (driver 'solomon,ssd1327') synthesize gray8 profiles via the
  compatible table (isGrayDisplay / colorFormatForDriver). The overlay
  generator emits the ssd1327 binding's required tuning props
  (oscillator-freq, start-line, remap-value, phase-length,
  display-offset, multiplex-ratio) with datasheet-starting defaults.
- Preview: gray8 storage mode (luminance bytes expand to RGB at the
  canvas push), gray blend/lerp/dim, luminance-sampled images, and the
  full-frame repaint semantic matching the device.
- demos/demo-gray (esp32s3 + ssd1327 128x128 on the rig wiring,
  compile-verified): AA title text, three gray shades, the gradient
  image at luminance fidelity, and a 60%-opacity blend row.
