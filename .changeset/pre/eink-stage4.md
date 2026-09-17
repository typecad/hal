---
'@typecad/cuttlefish': minor
'@typecad/ui': minor
'@typecad/framework-zephyr': minor
---

Stage 4 — e-ink (the refresh-model proof, DISPLAY-TARGETS.md)

Same 1bpp format as mono; the new axis is REFRESH: deferred — render on
signal change, flush with the panel's flash cycle, panel sleeps. The
zero-power static display is the feature.

- Panel class as data: EINK_PANEL_COMPATIBLES (ssd1608/1673/1675a/1680/
  1681, uc8151d/8175/8176/8179) classify drop-ins via isEinkDisplay;
  synthesis marks the profile displayClass 'eink' + mono format; a new
  displayClassForDriver strategy hook mirrors the class into the
  engine-side build profile (the same seam colorFormatForDriver proved),
  so deriveCapabilities flips to deferred-partial with all dynamic
  features off — UI_REFRESH_DEFERRED + the dirty-rect accumulator path.
- E-ink adapter: the mono adapter parameterized for the refresh model —
  skips the MONO01 negotiation (ssd16xx/uc81xx are MONO10-only; pushes
  always complement) and THROTTLES flushes to one flash per 2s minimum
  (TC_EINK_MIN_REFRESH_MS): the drivers block through the panel's BUSY
  line inside display_write, so an unthrottled binding tick would stall
  the app loop for seconds per change. The newest frame stays pending
  between flashes.
- Transitions and keyframes deleted outright on the deferred target
  (lowering decision): a 1-4s flash cycle cannot animate, and emitted
  tables would invite per-tick churn triggering throttled flushes for no
  visual change.
- Overlay: e-ink drop-ins ride the mipi-dbi SPI branch with
  busy-gpios from display.busyPin (required by both binding families,
  active-high), SPI capped at 4MHz (TFT's 80MHz default is far past the
  controllers' shift registers), and the compatible resolution fixed to
  prefer the drop-in driver string over the controller-default table.
  Kconfig enables CONFIG_SSD16XX / CONFIG_UC81XX by family;
  phandle-array props are never emitted from numeric binding fallbacks.
- demos/demo-eink (esp32s3 + ssd1680 296x176, compile-verified):
  static glanceable layout — bound readout, a progress bar (fills, no
  animation), the throttle noted on-panel.
