# Rendering And Scrolling Guardrails

These notes apply to this repository, especially `packages/cuttlefish/src/ui`,
`packages/cuttlefish/src/preview`, and generated demo UI output. The goal is to
keep Arduino display rendering stable on SPI TFT hardware where redundant
clears, out-of-order pushes, and full viewport repaints show up as flashing or
tearing.

## Do

- Route all runtime display operations through the Cuttlefish display shims:
  `ui_display_*`, `display_*`, `display_canvas*`, and touch shim helpers. Keep
  generated UI code independent from direct Adafruit display calls and direct
  XPT2046 touch calls.
- Treat scroll containers as canvas-composited viewports. For generic scrolling,
  prefer Mode B shift-and-repair: shift the cached viewport canvas with
  `memmove`, repaint only the exposed strip, draw the scrollbar into the canvas,
  then push the viewport once.
- Keep scroll drag invalidation small. A drag should call
  `ui_mark_scroll_view_dirty` for the scroll owner and repair external overlaps,
  not mark every child dirty unless a full scroll canvas repaint is required.
- When a buffered scroll canvas is active, keep the scroll owner out of the
  direct dirty-node display pass. The owner is represented by the canvas for
  that frame; direct-drawing it first clears the live viewport and causes flash.
- Push a buffered scroll canvas before drawing later outside layers that should
  appear above it. Higher-z overlays repaired before a late scroll-canvas push
  can be overwritten and look like tearing.
- Preserve draw order: lower `zIndex` first, then source order. Any scroll
  optimization must still respect this order for nodes outside the scroll
  subtree.
- Translate coordinates only while drawing into a scroll or repair canvas, and
  always restore the node box coordinates before leaving that draw path.
- Reuse persistent canvases (`__ui_container_canvas`, `__ui_repair_canvas`,
  `__ui_list_canvas`, `__ui_node_canvas`) instead of allocating every frame.
  Release them on navigation or real size changes.
- Invalidate the scroll canvas when a child inside a scroll container changes in
  a way that cannot be repaired by a shifted strip, such as standalone child
  geometry changes.
- Keep preview rendering behavior aligned with runtime rendering whenever adding
  UI features. CSS support is only useful if preview and generated graphics
  agree on layout, text metrics, clipping, and paint order.
- In loop-heavy render helpers, clip before doing expensive work. Compute the
  active draw target/clip once, then skip whole logical units such as wrapped
  text lines, rich-text segments, generated-font glyphs, image sample rows, and
  gradient rows/columns before calling `ui_display_*`/preview draw APIs. This is
  especially important while drawing into scroll repair strips.
- Build `@typecad/cuttlefish` before running tests that import package exports,
  so tests do not exercise stale `dist` files.

## Don't

- Do not restore generic scroll to a full viewport repaint on every drag frame.
  Full subtree redraws should be fallback behavior, not the normal path.
- Do not clear the live display viewport before pushing the scroll canvas. Clear
  the offscreen canvas or exposed repair strip instead.
- Do not push list, canvas, image, or child repair canvases directly to display
  coordinates while drawing inside a buffered scroll container. Composite them
  into the active scroll canvas.
- Do not add per-frame heap allocation, string allocation, or large temporary
  buffers in the dirty-node or scroll-drag paths.
- Do not rely on Adafruit_GFX or preview pixel clipping as the only protection
  inside nested loops. If a helper loops over glyph pixels, image pixels, text
  lines, or gradient rows, cull the invisible range before entering the inner
  loop.
- Do not enable full-screen framebuffer rendering by default to hide tearing. It
  can make small updates look like a whole-screen brightness flash on SPI TFTs.
- Do not add scroll cadence gates or accumulators that make touch lag behind the
  finger unless there is a measured hardware reason and a test/demo proving it.
- Do not mix direct display writes with shim-targeted writes in the same runtime
  path. The active target may be a canvas, not the physical display.
- Do not edit generated `src/out/main/main.ino` as the source of truth. Change
  the runtime/header/emitter code, then regenerate the demo output.

## Verification

For rendering or scrolling changes, run at least:

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npm run compile --workspace demo-ui
```

Add or update focused runtime-header and preview tests when changing scroll
invalidation, canvas composition, paint order, text layout, or CSS rendering
support.
