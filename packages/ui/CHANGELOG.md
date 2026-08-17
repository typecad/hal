# @typecad/ui

## Unreleased

- **Form validation states (shadcn-style).** `.input-error` (destructive
  input border), `.field-error` (destructive hint), `.field-success` (muted
  hint) join the kit. The runtime-driven flow the demo documents: a signal
  holds the invalid state, `ui.bind(input, 'borderColor', ...)` swaps the
  border between the input token and destructive literals, and
  `ui.bind(hint, 'visible', ...)` reveals the matching message — validated
  from an `on:click` (Save) and re-validated on every input commit
  (`onChange`). `borderColor` bindings already worked in both runtimes.

- **Accordion recipe (shadcn Accordion, single-open).** `.accordion` /
  `.accordion-item` / `.accordion-trigger-row` + `.accordion-trigger` /
  `.accordion-chevron` / `.accordion-content`: stacked collapsible sections
  where a signal holds the open index (-1 = all closed), content toggles via
  `ui.bind(x, 'visible', ...)`, and the chevron swaps `v`/`^` via a text
  binding. Two engine fixes surfaced by it: (1) `ui.bind(..., 'text', ...)`
  targets now draw their buffer (the preview only set `textBuffer` — the
  static text kept rendering unless auto-wire had flagged the node);
  (2) FALLBACK_CHARS gains the symbol row (`^~$'|`) so runtime-swapped
  strings have those glyphs, and the chevron recipe sizes its box wide
  enough for the `^` advance (a single char wider than its box wraps to
  nothing).

- **Tabs recipe (shadcn Tabs).** `.tabs-list` (segmented trigger row),
  `.tabs-trigger`, `.tabs-content-area` (fixed-height region) +
  `.tabs-content` (absolutely-stacked panes). Panes toggle via `ui.bind(x,
  'visible', () => signal === i)` — layout keeps every pane's box, so
  switching never re-flows — and the active trigger swaps literal hex
  background/color at runtime (compile-time tokens, so pin to the theme the
  way native_demo accents do). Panes stay fully interactive while shown.

- **Vertical separator recipe.** The kit's separator was horizontal-only;
  `.vseparator` (1px wide, `height: 100%` + `align-self: stretch`) is the
  shadcn `<Separator orientation="vertical" />` equivalent — a vertical rule
  that stretches to its row's cross height. `height: 100%` is required: the
  UA gives `hr` `height: 1px`, which out-ranks bare `align-self: stretch`.

- **New `<drawer>` element (shadcn drawer).** An author-styled absolute panel
  (`<drawer side="bottom|top|left|right">`) that slides in from its edge:
  the runtime animates per-node transform offsets over ~180ms, hides the
  subtree while closed (draw + hit-test gating), closes on outside taps and
  navigation, and exposes `ui.drawer.open(id)` / `ui.drawer.close(id?)` for
  programmatic control — with content that is ordinary elements, so theme
  tokens style it like anything else. Implemented in both runtimes (preview
  `applyDrawers`; device `ui_drawer_*` with slot bookkeeping, seeded closed
  at init, tick-driven slide, and visibility gating). Drawer slide frames
  mark the whole active screen dirty — the drawer's clear fills with the
  parent background only, so everything the panel covered (buttons, text,
  cards underneath) repaints as it slides away; without this the underlying
  canvas stayed flat background after close.
- **Preview: module-var rewrite is string-literal aware.** The
  `moduleScope.NAME` identifier rewrite ran over whole expressions, so prose
  inside template literals containing a module-var name as a whole word was
  rewritten too — a label like `` `taps inside: ${x}` `` rendered as
  "moduleScope.taps inside: ...". The rewrite now skips string/template
  literal contents (template `${...}` segments still rewrite; nested
  templates recurse).

- **`<select>` opens a modal option list instead of cycling.** Tapping a
  select now opens a centered list of its options (capped to ~60% of the
  panel height); tapping a row selects it, tapping outside dismisses. The
  current option renders inverted with a check mark. Implemented in both
  runtimes with the same contract as the on-screen keyboard modal: touch
  routing intercepts taps while open, the overlay is stamped after the dirty
  pass so tree redraws never bury it, closing marks the whole tree dirty for
  the erase repaint, and navigation resets it. Device nodes carry
  `optionCount` + `optionTextFn` (a generated per-select option table), and
  the auto-wired tap handler calls `ui_select_menu_open(idx)` instead of
  advancing the value.
- **`disabled` attribute is now honored.** The HTML parser captured `disabled`
  but nothing consumed it — disabled inputs still opened the keyboard and
  disabled buttons still pressed. The attribute now flows through the model
  and both runtimes: disabled nodes are not tap targets (no press, no
  keyboard — the device's `ui_hit_test` and the preview's `hitTest` skip
  them), and buttons/inputs draw with halved colors, matching the device's
  `(c >> 1) & UI_DIM_MASK` fade for the web-like disabled look.
- **Runtime-dynamic text no longer drops glyphs.** Font subsets were planned
  from authored static text only, so nodes whose text changes at runtime
  rendered missing glyphs once the new string fell outside the subset — a
  `ui.bind(x, 'text', …)` echo authored as "mode: alpha" showed "mode:
  amma" for Gamma and " eta" for Beta. The planner now widens faces to the
  fallback charset for dynamic-text nodes: `ui.bind(..., 'text')` targets
  (preview collects them from the script source), `{expr}` interpolation
  nodes, and `bind:text` attributes. Scroll containers also reserve a 4px
  breathing gap past their scrollbar strip, so stretched content no longer
  sits flush against the scrollbar.
- **`<select>` no longer wraps mid-word on wider options.** Two fixes: the
  layout now sizes a select to its widest option by RENDERED width rather
  than character count (with a proportional font, equal-length options like
  "Alpha" and "Gamma" differ in width), and the Yoga engine treats select
  leaves as text-like (measure function with available-width awareness) like
  text/button/check/radio — the generic leaf branch sized the width without
  the UA control padding, so the wider option overflowed and wrapped
  ("Gam / ma"). Inside `align-items: stretch` containers a select now
  stretches to full width, matching browser flex behavior. Selects also draw
  a dropdown chevron at the right end (both runtimes, with the label wrapping
  against the reserved 14px), and scroll containers reserve their 4px
  scrollbar strip as right padding so stretched children never lay out or
  paint under the scrollbar.
- **Check elements honor `border-radius` (switch pills).** A `<check>` with a
  radius (the shadcn kit's `.switch`) rendered as a plain rectangle in both
  runtimes; the background fill now clears to the backdrop and paints the
  rounded box (`fillRoundRect` / `ui_display_fill_round_rect`), and the 16px
  indicator becomes a circular knob that slides with state — hollow at the
  left when off, solid at the right when on (radio-dot geometry; no checkbox
  square or checkmark). Plain checkboxes (radius 0) are unchanged. The
  kit preset also sets `min-height: 26px` on `.switch` so the UA's 42px
  touch-target rule doesn't inflate the pill, and uses `--card` for the
  track — on a bare near-black page a `--muted` track reads as a stray
  gray box.
- **Preview `fillRoundRect` pill overshoot fixed.** The JS port clamped the
  arc-delta at 0 before the circle helper's +1, so for perfect pills
  (`h == 2r`, e.g. shadcn `.badge` with `border-radius: 999px`) every corner
  arc drew one row past the box — two orphan stubs flanking a background-
  colored line under the badge's straight bottom edge. The delta now passes
  through unclamped, matching the device's `CuttlefishGFX::fillRoundRect`
  (which never had the artifact).
- **Preview now uses the bundled default font.** The CLI build injects the
  bundled DejaVu faces before planning font assets; the preview's snapshot
  builder never did, so the UA root's `font-family: "DejaVu Sans"` resolved
  to no face and every project without hand-written `@font-face` rules fell
  back to the smoothed 5×7 bitmap font — the device rendered real
  antialiased glyphs while the preview did not. The preview injects the same
  faces (gated on the profile's color format, mono targets keep the bitmap
  font), so AA text works out of the box in both.
- **Preview overscroll no longer paints holes into neighbors.** Scrolling a
  screen past its bottom (wheel/rubber-band overshoot) ran the press-offset
  clear for dirty buttons whose draw position straddled the scroll viewport
  top; the clear/repair filled with parent background WITHOUT intersecting
  the scroll viewport — every other clear path clips — so it painted
  page-colored blocks over the fixed header (and anything else above the
  scroll body), and nothing re-dirtied that region afterwards, leaving
  permanent holes. The press-offset clear now clips to the node's scroll
  viewport like the rest of the clear paths.
- **Preview `@import` expansion (parity fix).** A `@import` inside a `.ui`
  `<style>` (e.g. `@import "./styles/shadcn.css"` from the component-kit
  preset) stayed literal in the preview: the CLI build expands imports before
  parsing (`loadUIModuleFromText`), but `buildPreviewSnapshot` concatenated
  the CSS raw, so imported tokens never loaded and model lowering rejected
  the unresolved `var(--x)` color strings — a project that built fine for
  device crashed the preview. The preview now expands each CSS part against
  its own base directory (sidecar css and html style blocks can live in
  different directories).
- **Preview diagnostic: unnamed interactive nodes.** `on:*` handlers,
  `bind:*` bindings, `{expr}` interpolations, and `<img src>` assets resolve
  their node by id in the preview and the device build alike (image asset
  loading keys on the node id — an id-less `<img>` silently renders an empty
  frame). The preview now emits a warning telling the author to add an id.
- **Preview animation frame loop.** CSS keyframe animations, transitions,
  and scroll settles froze between interactions: `start()` only ticked on
  input events and `ui.interval` bindings — there was no continuous frame
  loop, so the Transforms screen's animated dots only moved when a click
  happened to trigger a tick. `start()` now drives `tick()` from a ~20ms
  poller, mirroring the device's `loop()` → `ui_tick()` cadence (idle ticks
  are cheap — nothing dirty means no frame push). Also removed a leftover
  temporary `DBG-ONLINE` diagnostics self-test.
- **Virtualized list mid-scroll rendering.** During a scroll, the preview's
  dirty pass drew a list's outset box shadow BEFORE the list's shift path —
  the shadow rect spans the element, so it painted flat shadow color over
  the live viewport pixels that `shiftListViewport` then copied upward,
  leaving rows visible only through the repaired strip at the bottom of the
  list. Full repaints (initial view and the scroll extremes, where the delta
  exceeds the viewport) covered it back up, which is why only mid-scroll
  looked broken. Lists now skip the generic pre-draw and paint their outset
  shadow inside `drawListNode` on the full-repaint path only — matching the
  device runtime, which skips the outset shadow for lists in the main loop
  and draws it only when `!canShiftList` (node-draw-body.ts).
- **Preview mouse-wheel scrolling.** The canvas had no wheel handler, so
  wheel-scrolling a list or scroll container did nothing (drag was the only
  path). The client maps wheel deltas (pixels/lines/pages) to a new
  `PreviewUIRuntime.wheel(x, y, deltaPx)` that applies the delta to the
  scroll owner under the cursor via the same hit-scan a drag uses, with the
  standard overscroll settle and clamping.
- **List rendering fixes.** (1) Virtualized `<list>` rows are runtime text,
  but nothing fed their charset into the font-asset subset — a face built
  from unrelated static text rendered item strings with blank glyphs (a
  subset carrying '0' but not '1'-'9' drew "Item 10" as "Item  0"). List
  nodes now widen their resolved face to the fallback charset, preview and
  device alike. (2) The preview's GENERIC scroll passes (scrollbar draw +
  dirty-viewport clear) treated virtualized lists as ordinary scroll
  containers — drawing a second scrollbar with 565-only dim math (blue on
  rgb888) over the list's own, and clamping scrollY against the stale
  node-level contentHeight so drags visibly didn't scroll. Both passes now
  skip virtualized nodes, matching the device runtime's dirty-draw phase.
  (3) All remaining `(c >> 1) & 0x7BEF` dim sites (scrollbar track, range
  slider track, input placeholder) now dim at the active depth via one
  helper (device UI_DIM_MASK parity).
- **Preview `ui.window` facade.** Callbacks calling `ui.window.setTitle(...)`
  (lowered to `ui_window_set_title` on SDL targets) crashed in the preview
  with "Cannot read properties of undefined (reading 'setTitle')" — the
  preview's `ui` facade only exposed `signal`/`navigate`. It now implements
  the device's `ui.window` surface: `setTitle` updates the browser tab title,
  `setIcon` no-ops (no browser equivalent, matching hardware targets).

- **Fixed preview colors for rgb888/rgb666 targets.** The preview canvas
  push assumed the host framebuffer always held packed RGB565; rgb888
  snapshots (e.g. the native/SDL demo) store packed RGB888 and rendered
  channel-shifted (dark themes showed blue backgrounds, greenish cards,
  crimson borders). `HostAdafruitGFX` now carries the storage depth
  (`rgb565` unpacks, `rgb888` passes through, `rgb666` quantizes to 6
  bits/channel at the push — device panel parity), seeded from the
  snapshot's colorFormat. Transition/keyframe color lerps were also
  565-only; they now lerp per 8-bit channel on 888/666 targets.

### Web compatibility pass (predictability for HTML/CSS authors)

- **Content is never silently dropped.** Unknown HTML tags render as generic
  containers (text-only leaves become text nodes) with a warning instead of
  discarding the subtree; `<ul>/<li>` render with `•`/`N.` markers; `<hr>`,
  `<textarea>` (as single-line input, warned), and `<input
  type="checkbox|radio|range">` (aliases of `check`/`radio`/`range`) are
  accepted. Stray text next to element children becomes anonymous text
  children (CSS anonymous-box model) — `<div>Total: <b>3</b></div>` keeps
  "Total:" and flows inline-only mixes as one line.
- **Units honored like a browser.** `width: 50%` resolves against the parent
  (was: 50px), `margin: 0 auto` centers via auto margins, and 3/4-value
  margin/padding shorthands expand TRBL correctly.
- **`background: transparent` paints nothing** (was: opaque black). Border
  color defaults to `currentColor` (the node's text color) when unspecified.
- **Cascade specificity.** Author rules cascade by specificity
  (inline > id > class/attribute > element, source order within a level) and
  the UA sheet loses to any author rule; previously pure last-rule-wins.
- **Bundled default font.** Color displays get an implicit DejaVu Sans
  (regular + bold, from `assets/fonts/dejavu/`, Bitstream Vera License —
  LICENSE + checksum README ship alongside and font tables carry an
  attribution comment) so antialiased text at exact pixel sizes works out of
  the box. Monochrome displays keep the stock bitmap font.
- **Display-anchored UA defaults.** The UA stylesheet derives its type scale
  from the display profile (16px root on large panels, 14px at 320×240, 12px
  small color, 12px bucket-snapped mono), adds browser-like heading/p
  margins, makes h3 bold again (the bold-inflates-size runtime quirk is
  gone), scales touch-target min-heights, styles `hr`, and exposes
  `.ui-scroll-body`/`.ui-screen-header` aliases for `.scrollBody`/
  `.screenHeader`.
- **CSS compatibility report + `--strict-css`.** Partial-honor values now
  warn (`css-*` diagnostics): ignored alpha, `content-box`, unsupported
  `display`/`position` values, `font-size` in %/em, unitless `line-height`,
  font-size viewport share, stock-font size bucketing, UA-scale summary.
  `cuttlefish build --strict-css` upgrades them to errors. The `border`
  shorthand accepts bare/decimal widths; the `font` shorthand applies its
  `size/line-height` pair.
- **Second element wave.** `<meter>` aliases `progress`; `<output>`, `<small>`,
  `<dl>/<dt>/<dd>` (bold term, indented description), `<fieldset>/<legend>`,
  `<form>` (plain container, no warning), `<pre>/<code>/<kbd>/<samp>` (inline
  code flows inside paragraphs) with a bundled **DejaVu Sans Mono** default
  face for the code family. MCU-impossible elements (`<svg>`, `<video>`,
  `<audio>`, `<iframe>`, `<embed>`, `<object>`, `<picture>`) render as generic
  containers but warn specifically with the native alternative (`<canvas>`,
  `<img>`); `<source>`/`<track>` are skipped as metadata. Exotic
  `<input type=...>` values (date, email, ...) normalize to a single-line text
  input with a warning.
- **Tables (equal-width flex approximation).** `<table>/<tr>/<td>/<th>` with
  `<thead>/<tbody>/<tfoot>/<caption>`: rows are flex rows of equal-width
  stretched cells (`td`/`th` get `flex:1` + padding; `th` bold + centered like
  browsers). No auto column sizing — an info diagnostic says so at build time,
  and `colspan`/`rowspan` warn (each renders as a single cell). `<col>`/
  `<colgroup>` are skipped as metadata.
- **Preview stock-font fallback.** The preview runtime no longer warns
  "Default GFX font not found … text pixels will be blank" for projects
  without a vendored `lib/Adafruit_GFX_Library` — it falls back to the
  glcdfont table already bundled in `@typecad/cuttlefish`
  (`api/shared/glcdfont.ts`). A project-local Adafruit_GFX copy still wins
  (byte-identical to what the firmware compiles against).
- **Local `@import` support.** Relative stylesheet imports are inlined at
  build time (recursive, cycle-guarded). Remote/data: imports keep the
  existing unsupported-@import warning.
- **shadcn-style component kit.** `cuttlefish add shadcn` (cuttlefish
  package) copies a token + recipe preset into `src/styles/shadcn.css` —
  copy-and-own, like shadcn/ui. CSS-variable tokens (light + `.dark`),
  button/badge/card/input/label/separator/alert/skeleton/progress/avatar/
  switch recipes, and a `.row` utility, all over the native elements.
- **Stock shadcn themes paste in unmodified.** Color resolution accepts the
  classic HSL channel-triplet dialect (`--primary: 222.2 47.4% 11.2%`)
  through bare `var()` (and `hsl(var(--x))` as before), plus `oklch()`
  (Tailwind v4 era themes) via OkLab → sRGB conversion. Verified against
  shadcn's own zinc values.
- **calc() unit fix.** `calc(0.5rem - 2px)` now correctly resolves to `6px`
  (it previously produced `6rem` — 96px — from first-unit-wins logic).
  Percent + length mixes (`calc(50% - 10px)`) stay literal instead of
  producing a wrong number.

## 1.0.0-alpha.12

### Patch Changes

- Fixed two emitted-runtime compile errors that broke every Arduino UI build
  using the PSRAM canvas allocator (e.g. `demo-display`):
  - `ui_create_canvas_best`'s PSRAM debug `printf` lines emitted a literal
    newline inside the C++ string literal (the `\n` in the runtime-header
    slice's template literal was a JS escape, not the two C++ characters) —
    "missing terminating \" character". Now escaped as `\\n`.
  - `ui_draw_node_body` took a `const UINodeDrawCtx*` parameter, but the
    Arduino `.ino` preprocessor auto-inserts a forward declaration of every
    function near the top of the sketch — before the struct is defined — so
    the generated prototype failed with "'UINodeDrawCtx' does not name a
    type". The parameter is now `const void*` (cast back inside), keeping the
    auto-generated prototype primitive-only and valid.

### Minor Changes

- ## Display integration wizard (`npx @typecad/ui --config`)

  Installing `@typecad/ui` used to leave a gap: integrating a display requires
  choosing hardware (panel, bus, pins, speed, touch) and writing the
  `display` section of `cuttlefish.config.ts` by hand. The package now ships a
  `typecad-ui` bin, so the flow after `npm install @typecad/ui` is:

  ```bash
  npx @typecad/ui --config
  ```

  ### What it does

  - **Display selection** with hardware-aware defaults: the built-in profiles
    (`ili9341-spi`, `st7796-spi`, `ssd1309-i2c`), the desktop SDL simulator, or a
    fully custom driver (name, bus, resolution, color format).
  - **Bus wiring questions** — SPI (CS/DC/RST/backlight, frequency in MHz,
    optional SCK/MOSI/MISO override) or I2C (address, optional reset pin),
    prefilled from any existing `display` section on re-runs.
  - **Orientation + rendering** — rotation, antialiasing, and an advanced color
    branch (color order / inversion). ST7796S keeps the demos' proven `bgr` +
    non-inverted defaults.
  - **Touch** — none, resistive (XPT2046 / STMPE610 / 4-wire analog), capacitive
    (FT6336U / GT911 / CST816S), or a custom adapter file, each with its pins,
    I2C address/speed, IRQ/reset, and calibration (raw-ADC defaults for
    resistive, native-panel pixel space for capacitive — matching the demos).
  - **Theme hooks** — optional `themeCss` / `themeClass`.

  ### How it writes the config

  The `display` section is spliced into `cuttlefish.config.ts` through the
  TypeScript AST: only that section changes, every other section and its
  comments survive byte-for-byte, unmanaged display keys (`scroll`,
  `scanlineSync`, …) are carried over, and the edited file is syntax-checked
  before anything is written. GPIO collisions between display and touch wiring
  warn before the write. If the config's `entry` points at a missing `.ui`
  file, the wizard offers a documented-syntax starter screen, then prints the
  exact `arduino-cli lib install` (with the real Library Manager names —
  `RAK14014-FT6336U` for FT6336U, the ST7735/ST7789 fork note for ST7796S),
  preview, compile, and flash commands.

  No config yet → the wizard points at `npx @typecad/cuttlefish init` first.
  Non-interactive stdin → a clear error instead of a hang. `--help` / `--version`
  included; unknown flags exit 2.

  ### Internals

  New `src/wizard/` module (prompts, display/touch catalog, AST config writer,
  starter template) exported as `@typecad/ui/wizard` for reuse and tests;
  runtime deps added: `chalk` and `typescript` (both already present via the
  cuttlefish peer). `tests/packages/ui/integration-wizard.test.ts` covers the
  catalog, rendering, splice cases (insert / replace / CRLF / comma-and-comment
  handling), pin-conflict detection, the starter template, and a round-trip
  through cuttlefish's real `parseConfigFile` proving wizard output loads the
  same way the build loads it.

### Patch Changes

- ## Standalone-install dependency fixes

  Declared the dependencies each package actually consumes at build/test time,
  so installs outside the monorepo resolve without relying on hoisting:

  - **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
    test harness generates `cuttlefish.config.ts` files whose
    `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
    typecheck in standalone installs) and `@typecad/framework-zephyr` as an
    optional dependency (the `west build`/`west flash` compile path requires it
    dynamically and degrades gracefully when absent).
  - **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
    dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
    resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
  - **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
    regular dependencies (it is imported throughout `src/`), so installing
    `@typecad/ui` pulls the transpiler automatically like every other consumer.
  - **`@typecad/safety`** dropped its duplicate peerDependencies block —
    `@typecad/cuttlefish` and `@typecad/hal` were declared in both
    `dependencies` and `peerDependencies`; the regular dependencies (the pattern
    every other package uses) are kept.

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.12

## 1.0.0-alpha.11

### Patch Changes

- Updated dependencies [46f25f2]
  - @typecad/cuttlefish@1.0.0-alpha.11

## 1.0.0-alpha.10

### Patch Changes

- Updated dependencies [c7ea1b5]
  - @typecad/cuttlefish@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- Updated dependencies [a27476a]
  - @typecad/cuttlefish@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- 0320018: ## ESP32: BLE, WiFi/HTTP, RMT, native display + touch, ESP-IDF v6

  The ESP32 framework is now a first-class code-generation target alongside the
  AVR and Arduino cores, with native ESP-IDF lowering across every HAL category.

  ### BLE peripheral (NimBLE)

  - Full GATT peripheral lowering via NimBLE: `ble.server(name)`,
    `.characteristic(uuid, type, perm)`, `.onRead()/.onWrite()/.onConnect()/
onDisconnect()`, `.notify()`, `.set_tx_power()`.
  - Supports 16-bit SIG UUIDs, custom 128-bit UUIDs, and all read-value types
    (numeric, UTF-8, raw bytes). Auto-creates a default service when
    characteristics have no explicit parent.
  - Async `ble.until_connected()` split lowers to a non-blocking poll state.
  - `Preferences` backed by native NVS lowering (reads/writes persist across
    reboots); `Power.deepSleepPin()` pin-wakeup.

  ### WiFi + HTTP client (native, async)

  - Native WiFi HAL with async lowering: `WiFi.connect()` lowers to start + poll
    states so a heartbeat loop keeps running while the link comes up. AP mode,
    tx power, channel, max clients, and client-count queries.
  - HTTP client (`http.get/post`, async, HTTPS-insecure) end-to-end lowering with
    brownout-recovery fixes. Includes a hardware-test harness
    (`npm run test:http` + `test:hw:http`) and a compiled-output regression
    corpus (`demos/wifi-demo/out-samples`).

  ### RMT (ESP32-S3 onboard WS2812)

  - `rmt.*` HAL-op IR + ergonomic stubs + `hal/rmt.ts` wrapper. IR-scanning init
    lines + per-op lowering, wired into dispatch with forced `esp_driver_*`
    CMake deps. MSB-first `txInit` for WS2812. Drives the ESP32-S3 onboard RGB.

  ### Native display + touch adapters

  - Native ESP32 SPI display adapters (ILI9341, ST7796, SSD1309) and touch
    adapters (XPT2046, STMPE610, GT911, CST816S, FT6336U) with PSRAM + rendering
    fixes. License attribution headers added to touch adapters (NOTICE updated).

  ### ESP-IDF v6 migration

  - `framework-esp32` migrated to ESP-IDF v6 public APIs: NimBLE API + callback
    fixes, removed deprecated `esp_nimble_hci`/`esp_ble_tx_power_set`, volatile
    `++` replaced with `+ 1` for GCC 13+ `-Werror=volatile`. Compiles clean on
    v6 (`idf.py build` passes).

  ### Bug fixes

  - ownership-analysis: const-array demotion now fires for value-arg mutating
    methods lowered via `__RAW_STMT__` (e.g. `arr.push()` on a `const` binding no
    longer emits a non-compiling `const std::vector` + `push_back`).
  - framework-avr: the UART driver shim is kept alive for `console.*` programs,
    since the AVR console polyfill routes `console.log` through `_uart_*` symbols
    (previously emitted an undefined-symbol link error).

- Updated dependencies [0320018]
  - @typecad/cuttlefish@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.4

## 1.0.0-alpha.3

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.
