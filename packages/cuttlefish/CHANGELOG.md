# @typecad/cuttlefish

## 1.0.0-alpha.13

### Patch Changes

- @typecad/safety@1.0.0-alpha.13
- @typecad/ui@1.0.0-alpha.13

## Unreleased

- **Fixed the preview debug overlay drawing above its elements.** The
  overlay canvas was positioned before the app canvas's real
  `--display-aspect` applied (the 4/3 CSS fallback was still in effect);
  the canvas is vertically centered, so switching to the display's true
  aspect (e.g. 480x320's 1.5, shorter than 4/3) shrank and moved it down
  while the overlay stayed at the old position — every debug box sat that
  far above its element (the header's "shadcn kit" box floated directly
  over the title). The aspect variable now applies before the overlay
  syncs, and a ResizeObserver re-syncs on any later layout-driven size
  change (max-height, container reflow), not just window resizes.

- **`ui.dialog.open/close(id)` and `ui.toast(id)` lower at build time** to
  the shared drawer slot calls (`ui_drawer_open(N)` / `ui_drawer_close(N)`),
  resolving `<dialog>` / `<toast>` ids with the same diagnostics as drawer
  ids (unknown id, non-literal id, unsupported method).

- **`cuttlefish add` and `cuttlefish theme` are gone.** The shadcn kit is
  now built into `@typecad/ui` (always included, cascade-overridable), which
  removes the need for the scaffolding and theme-splicing commands and their
  flags (`--theme`, `--force` on add). Themes are plain CSS files the user
  `@import`s (see the `@typecad/ui` entry). `add-preset.ts`, `theme-tokens.ts`,
  the `assets/shadcn/` templates, and their package exports are removed.

- **Touch calibration code is self-contained.** `ui_poll_touch()` emitted bare
  Arduino `map()` calls, but the map/constrain helpers are capability-gated
  (`usesMap` reflects SCRIPT-level map() calls only) — on frameworks without
  a core map() (Zephyr) the touch body failed to link. The emitter now
  inlines the map arithmetic.

- **shadcn kit: Spinner.** `<view class="spinner"><view class="spinner-dot"/>
</view>` — an indeterminate loading indicator: a dot orbiting inside a ring
  via pure `transform: translate()` keyframes. translate lerps continuously
  between stops (unlike rotate, which only renders exact quarter turns), so
  the orbit is smooth. The dot's BASE position is the orbit's top-left
  corner — base + travel/2 must equal the ring center (with the 2px border,
  top/left 2px) — so the path circles the ring's center instead of its
  bottom-right quadrant. Documented in the kit header with sizing notes;
  demoed on the Alert & Skeleton screen.

- **New `usesWallClock` analysis flag + `__tc_print`/`__tc_println`
  helper tracking.** `usesWallClock` is set when the program references
  `millis()`/`micros()` directly — without the `delay()` conflation
  `usesMillis` carries (framework-avr derives its native-timing gate from
  that conflation, but frameworks whose `delay()` lowers straight to a
  native sleep must not treat a delay-only program as a clock consumer;
  framework-zephyr gates its `millis()` shim on the new flag). The
  test-runner console helpers injected by `@typecad/expect`'s
  preprocessor are now recorded in `usedPolyfillHelpers`, so frameworks
  can emit their definitions (and `<cstdio>`) only when the calls exist.

- **Removed `output.optimize` (dead config).** No framework ever consumed
  it — the only consumer, framework-esp32, is deleted — so the
  `optimize: 'size'` line every scaffold stamped into new configs was
  misleading. Removed from the schema, the exported `CuttlefishConfig`
  type, `ToolchainOptions`, and the project templates. Existing configs
  that still carry the key keep building: the loader warns
  ("'output.optimize' has no effect and is deprecated — remove it") and
  drops it before strict validation. Optimization is framework territory —
  e.g. `zephyr.kconfig` `CONFIG_SIZE_OPTIMIZATIONS` /
  `CONFIG_SPEED_OPTIMIZATIONS`.

- **Full tweakcn exports work as theme files, and the shadow tokens are
  live.** Save the whole export (Tailwind `@import`/`@theme inline`/
  `@layer` scaffolding included) as `src/styles/themes/<name>.css` — the
  loader reads the `:root`/`.dark` blocks and ignores the rest. The kit now
  consumes the named shadow set: `.card` uses `box-shadow: var(--shadow-sm)`
  (multi-layer `hsl(... / a)` shadows parse natively; the kit ships a
  `--shadow-sm` default so themes without shadows still resolve). Token map
  documented in the kit header + paste template: popover/ring (no focus
  rings on bare metal), chart-_, sidebar-_, font-_ (fonts are compiled into
  firmware), tracking-_ (sub-pixel at TFT sizes) and spacing are ignored.

- **Included shadcn themes + `cuttlefish theme`.** The kit now ships theme
  token sets under `assets/shadcn/themes/` (`default` = the hand-tuned
  zinc-family tokens; more paste-in ready). Themes are also discovered from
  the PROJECT first — `src/styles/themes/<name>.css` (wins over same-named
  package themes), so pasting a theme from ui.shadcn.com / tweakcn is
  dropping a file into your own project, never node_modules. Start a
  project on one with
  `cuttlefish add shadcn --theme <name>`; swap an existing project's
  `src/styles/shadcn.css` in place with `cuttlefish theme <name>` (recipes
  are preserved — only the `:root`/`.dark` token blocks are replaced).
  Splicing MERGES: theme declarations override, kit-only extras
  (`--destructive-background`) survive, and a required-token guard rejects
  themes that would leave recipes unset. Block matching is comment-aware —
  the kit header's literal `.dark { ... }` documentation mention previously
  captured the splice, injecting tokens into the comment and silently
  leaving the real dark block (and the render) unchanged. Pasting your own: the
  `_paste-a-theme.css` template documents exactly where the blocks go;
  both stock dialects (HSL triplets, Tailwind-v4 oklch) already parse.

- **Debug builds say what they're doing, in cuttlefish blue.** The plain
  `Loaded FrameworkStrategy from @typecad/framework-zephyr` log that appeared
  under `--debug` is now a styled step line — `⇉ Preparing to debug using
zephyr` — matching the cyan `⇉ Transpiling...` / `⇉ Compiling for ...`
  family (framework name from the loaded strategy's id; still debug-gated).

- **`cuttlefish create` now generates a starter debug profile.** After the
  dependency install, create calls the framework's optional
  `writeProjectDebugArtifacts` export (new `create/debug-artifacts.ts`
  helper) so gdb-capable targets (Zephyr esp32s3) get `.vscode/launch.json`

  - `tasks.json` immediately — pressing F5 no longer opens the
    "select a debugger" menu on a fresh project. Best-effort by design: the
    framework package isn't resolvable yet (`--no-install`) or the framework
    has no debug support, create silently skips (the first `--debug` build
    writes the artifacts anyway), and the next-steps output gains an F5 hint
    when a profile was written.

- **Fixed: output-pin shadow reads went stale in multi-file programs.** The
  shadow-variable updates for `gpio.write`/`gpio.toggle` were decided at
  emit time from the pin tracker's live state, but every file's IR build
  resets the tracker and all files build before any emit — so writes in
  earlier-built files never updated the shadow variable their reads
  consulted (`OutputPin.read()` silently returned a stale constant). The
  `updatesShadow` flag is now baked into the write/toggle ops at the end of
  each file's IR build, making emit independent of tracker state.

- **AUTOSAR: `A18-5-10` now covers the C dynamic-memory family.** The
  detector also catches `free()` and ESP32 `ps_malloc()` (previously
  invisible — `ps_malloc` has no word boundary before `malloc`), and the
  Arduino/Zephyr canvas teardowns (explicit dtor + `free()` on
  malloc-backed operator-new targets) are recorded deviations instead of
  passing unrecorded. Any other `free()`/`malloc()` in new shims now fails
  `--autosar=strict` until justified.

- **shadcn kit: `.accordion-trigger` sets `border: none`.** The UA sheet
  gives every button a 1px border colored by the foreground token, so each
  accordion trigger rendered with a bright outline around its plain text
  row on the dark theme. New `cuttlefish add shadcn` installs get the fix.

- **`cuttlefish add` now exists** (`add <preset> [--force]`): copy-and-own
  preset scaffolding (shadcn kit first). Also fixes surfaced by the first
  full device compile of the canonical demo: ui.drawer build-time lowering,
  bind:value write-back assignment, and element `.text.length` → strlen in
  expression lowering.

- **Preview debug overlay.** A second canvas stacked over the display draws
  per-frame debug geometry from the runtime, toggled per mode from the new
  Debug overlay panel, `?debug=boxes,clips,dirty,inspect`, or the D key
  (cycles boxes → clips → dirty → off):

  - **boxes** — every visible node's current draw rect (transform/press/
    drawer/scroll offsets applied), colored by kind (views cyan, text
    yellow, interactive magenta, img/canvas orange, lists green);
    interactive elements with no handler get a red corner mark (the
    id-less-element trap).
  - **clips** — scroll viewport rects: dashed outline + faint tint.
  - **dirty** — flashes whatever the runtime repainted that frame (fades
    until the next repaint); makes overdraw and missing underlying redraws
    immediately visible.
  - **inspect** — taps report the topmost node (id, tag, kind, box,
    tappability) into Diagnostics instead of interacting; Ctrl-click always
    inspects without entering the mode.
    Zero cost while every mode is off (the runtime's capture flag gates the
    per-tick paint-rect collection). The mode rows are generously-sized click
    targets (hover-highlighted labels, 14px checkboxes) and a live state line
    under them shows "overlay: off — check a box or press D" versus the active
    mode list, so the intentionally-invisible off state is never mistaken for
    a broken overlay. The overlay canvas is explicitly background-transparent
    (the page's `canvas { background: #000 }` rule otherwise made it an
    opaque black sheet hiding the content being inspected) and runs its backing
    store at CSS-pixel resolution so strokes are 1 CSS px thin — thick
    logical-pixel strokes buried text under the outlines.

- **Preview reloads the `@typecad/ui` engine per snapshot build.** The server
  cached the `buildPreviewSnapshot` module graph from its first snapshot
  build, so engine rebuilds (font planning, layout fixes, theme handling)
  never reached a running preview — every engine change silently required a
  server restart, producing repeated "fixed but the preview still shows it"
  sessions. The module now loads via a cache-busted `file://` URL per
  snapshot request, matching the config hot-reload behavior.

- **Preview re-reads `cuttlefish.config.ts` on every snapshot build.** The
  server parsed the config once at startup, so config edits — `themeClass`
  flips (e.g. the shadcn kit's `light`/`dark` token sets), entry changes,
  display tweaks — had no effect until the server was restarted. Each
  `/snapshot.json` request now re-parses the config (a mid-edit file that
  fails to parse falls back to the last good one), so a page refresh picks
  up config changes.

- **Preview canvas tolerates non-capturable pointers.** `pointerdown` called
  `setPointerCapture(event.pointerId)` unguarded; synthetic pointers (CDP /
  browser automation) have no capturable pointer id, so the call threw
  `InvalidPointerId` and killed the tap before `runtime.pointerDown` ran.
  Capture is now best-effort (it only matters for drags that wander off the
  canvas).

- **Preview module routes now send `Cache-Control: no-store`.** Heuristic
  browser caching served stale host-runtime/client modules after rebuilds,
  producing phantom bugs in the preview that were already fixed (and making
  preview debugging unreliable).

- **Fixed the preview page showing a black canvas** with "Failed to resolve
  module specifier '@typecad/ui/preview/host-ui-runtime'". The browser client
  imports the host runtime and its `@typecad/cuttlefish/api/shared`
  dependency as bare specifiers, which browsers cannot resolve. The preview
  page now ships an import map: `@typecad/ui/` maps to a new
  `/__cuttlefish-ui/` route serving that package's dist (with ESM
  extensionless-path fallbacks), and `api/shared` maps to a browser-safe shim
  that re-exports only `resolveScrollConfig` (the barrel re-exports node-only
  modules — fs, zod — that cannot load in a browser).
- **Fixed `cuttlefish preview` failing at startup** with "UI hook is not
  registered". The preview server drives the UI engine directly but never
  loaded it — hook registration only happened inside `transpileFile()`, which
  preview doesn't run. `runPreviewServer` now loads the engine up front and
  fails with a clear "requires @typecad/ui" message when the package is
  absent. (Regression from the preview/engine package split.)
- **`cuttlefish add <preset>`** — scaffolds copy-and-own assets into a
  project. First preset: `cuttlefish add shadcn` copies the shadcn-style
  token + component-recipe stylesheet to `src/styles/shadcn.css` (no-clobber
  unless `--force`) and prints linking instructions (`@import` in a `.ui.css`
  or `<style>` block). Presets ship in the package's `assets/` and are never
  build-time injected — the user owns the file.

## 1.0.0-alpha.12

### Patch Changes

- Stale generated sources are now swept from the out dir after emission: a
  compiled-source file (`.cpp`/`.cc`/`.c`/`.h`/`.ino`) in the out dir root,
  `src/`, or `main/` that the current run did not write is deleted. Leftovers
  from renamed entries (the old `main.cpp` next to the current `src.cpp`) or
  removed modules previously survived forever — and Zephyr's CMakeLists globs
  `src/*.cpp`, so they compiled into duplicate-symbol link errors
  (`multiple definition of 'setup()'`). Build caches (`out/build` etc.) and
  sidecar JSONs are untouched.

- `CuttlefishConfig.mcu` is now optional in the public type, matching the
  runtime schema and loader: native/host targets legitimately omit it (a
  desktop build has no MCU — the loader generates a boardless
  `@typecad/board` shim), so configs like the native SDL demo no longer fail
  typechecking with "Property 'mcu' is missing". Embedded targets should
  still set `mcu` (or the deprecated `board`).

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
- Updated dependencies
  - @typecad/ui@1.0.0-alpha.12
  - @typecad/safety@1.0.0-alpha.12

## 1.0.0-alpha.11

### Minor Changes

- 46f25f2: ## framework-zephyr parity with framework-arduino

  Closes the genuine feature gaps where the (newer) Zephyr framework lagged the
  Arduino framework. The two areas Arduino led — a `licenses` subcommand and the
  `dac`/`fs`/`hwtimer` HAL categories — are now closed.

  ### `cuttlefish licenses` for Zephyr (was missing entirely)

  - **Shared SPDX core** (`@typecad/cuttlefish/api/shared`): extracts the
    framework-agnostic license-detection engine — the SPDX table, marker/alias
    matching (`identifySpdx`), copyleft classification (`classifyRisk`), and the
    LICENSE-file / source-header / manifest resolver (`resolveLibraryLicense`) —
    out of `framework-arduino/src/licenses.ts` into a reusable
    `spdx-licenses.ts`. Arduino is refactored to consume it (its public API and
    tests are unchanged — a non-regressing import-only change).
  - **Zephyr presenter** (`framework-zephyr/src/licenses.ts`): enumerates the
    Zephyr kernel (`$ZEPHYR_BASE`) + the west manifest projects (`west list`)
    and resolves each one's license through the shared core, rendering a
    copyleft-sorted table that mirrors the Arduino presenter. `--strict` exits
    non-zero on any strong-copyleft / unknown dependency; a missing west install
    degrades gracefully instead of crashing. Declared `licenses: { available:
true }` in the Zephyr manifest and exported as the dispatcher-facing
    `licenses` alias. - **Build-based project scope** — unlike Arduino's installed-library
    registry, a Zephyr workspace's west manifest carries _every_ vendor HAL and
    library (most unused by any single project). The default scope therefore
    reports only the dependencies the firmware actually links, derived from the
    last `cuttlefish build`'s `compile_commands.json` (a module is listed iff
    one of its sources was compiled — e.g. an xiao_ble/nRF52840 build links
    `hal_nordic` + the kernel, not the other ~60 modules). Without a build,
    only the kernel is shown with a hint to build first; `--all` lists every
    west module. Module LICENSE files are sought under `zephyr/` and `src/`
    subdirs too (e.g. `hal_nordic` ships `zephyr/LICENSE.txt` → BSD-3-Clause). - The CLI accepts `cuttlefish license` (singular) as an alias, and the shared
    resolver now matches lowercase/`.rst` LICENSE files (e.g.
    trusted-firmware-m's `license.rst`) using their real on-disk name so it
    works on case-sensitive filesystems.

  ### HAL coverage: `dac`, `fs`, `hwtimer` lowerings

  These were previously declared unsupported (the Zephyr manifest flagged `dac`/
  `fs` as "not yet wired"); they now lower to native Zephyr APIs, with
  `profileDiagnostics` gates that surface clear errors for misuse on targets
  lacking the peripheral (mirroring the existing ADC/WiFi gating).

  - **`dac`** — Zephyr DAC driver (`dac_channel_setup` + `dac_write_value`)
    driven by a new chip-descriptor `dac` field. ESP32 declares its two 8-bit
    channels (GPIO25/26); nRF52840 / ESP32-S3 (no DAC) lower to a comment and
    trip `zephyr-dac-pin-unavailable`.
  - **`fs`** — Zephyr FS API (littlefs on the storage partition). A lazy-mount
    shim (formats on first use) backs `begin`/`read_text`/`write_text`/
    `exists`/`remove`; the scaffold emits `CONFIG_FILE_SYSTEM` +
    `CONFIG_FILE_SYSTEM_LITTLEFS`, and the overlay enables the DAC node / points
    at the storage partition.
  - **`hwtimer`** — Zephyr counter driver: `set_frequency` → top value
    (`counter_freq/hz`) + `on_overflow` callback, `start` arms both, `stop`
    halts. A new `hwtimer.controllers` descriptor field maps the instance index
    to a counter nodelabel (nRF RTC1; RTC0 is kernel-owned). The JS
    `setInterval`/`setTimeout` `k_timer` polyfill is unaffected.

  ### Coverage the manifest validator confirms

  The manifest declares `dac`/`fs`/`hwtimer` `supported` and the validator probes
  each op against the resolver — all now lower. The new categories join the
  `halResolutionTests` snapshot suite (`dac.test.ts` rewritten; `fs.test.ts`,
  `hwtimer.test.ts` added) and the shared SPDX core has its own focused test.

  ### No-STL string/array polyfills (compile gap)

  Zephyr is a no-STL target (`hasVector`/`hasString = false`), like AVR — but it
  was missing the two polyfills AVR ships, so programs using string methods or
  dynamic arrays emitted undefined symbols and failed to compile. Two fixes:

  - **Polyfill definitions** — `generateNativePolyfills` now emits a STL-free
    `static_array` (`__tc_StaticArray<T,N>`, mutated/struct array literals + array
    methods) and `string_methods` (`__tc_toUpperCase`/`__tc_endsWith`/… `const
char*` helpers, inline ASCII case conversion so only `<cstring>` is needed).
    Both are declared in `nativePolyfills()` and the manifest's `polyfills.emitted`.
  - **String-method rewrite** — `normalizeRawExpression` now calls
    `applyStringMethodRewrites` (Arduino always did; Zephyr omitted it), so
    `s.toUpperCase()` lowers to `__tc_toUpperCase(s)` and `s.includes(x)` to
    inline `strstr(...)` instead of a member call on `const char*`.

  Verified end-to-end: a program using `s.toUpperCase()` / `s.includes()` /
  `let a = [...]; a.push(...)` now transpiles + compiles for `xiao_ble` (the
  emitted `__tc_StaticArray<double,3>` + `__tc_toUpperCase(s)` resolve). Covered by
  `tests/packages/framework-zephyr/polyfills.test.ts`.

  ### Monochrome OLED display (SSD1306) + direct-display fix

  Closes the display-driver coverage gap (Arduino ships `ssd1309`; Zephyr now
  ships `ssd1306-zephyr`), skipping e-ink. Two coupled changes:

  - **Direct-display bug fix** — `gfx.ts` (the `display_*` runtime for direct
    `display.*` HAL ops, no `@typecad/ui`) was dead code: `shimLines` gated it on
    `!providesDisplayAdapter()`, which is always `true`, so it was never emitted —
    leaving _every_ direct-display program (ili9341/st7796 included) with five
    undefined symbols. The gate now uses the per-program UI signal
    (`usesDisplay && !entryHasUI()`), so the runtime is emitted only when no UI
    adapter (which defines the same `display_init`) will be.
  - **Mono GFX runtime** — `buildDisplayRuntime` now branches on
    `profile.colorFormat`: RGB565 keeps the one-row line buffer; **mono** uses a
    full page-framebuffer (the standard model for page-buffered OLEDs; the
    AGENTS.md "no full framebuffer" guardrail targets RGB SPI TFTs, not OLEDs)
    with Zephyr MONO01 packing (horizontal, MSB-first). `display_fill_rect`/
    `draw_rect`/`draw_text` set bits (`color != 0 ⇒ lit`); `display_flush` pushes
    the whole buffer via `display_write`.
  - **Profile + adapter guard** — new `ssd1306-zephyr` profile (128×64 mono); the
    RGB565/SPI UI adapter declines mono drivers (mono is direct-`display.*` only —
    full `@typecad/ui` CuttlefishGFX rendering on mono OLED is out of scope).

  Caveat: there is no OLED fixture/demo in the repo, so mono rendering is
  validated at the C++-string level (snapshot tests in `display/gfx.test.ts`,
  same bar as the existing `gfx.ts`); the MONO01 bit orientation is isolated to
  `__tc_set_pixel` for a trivial hardware-reveal fix. Manifest + 422-test
  framework-zephyr suite pass.

  ### Intentional differences (unchanged)

  The optional strategy-method differences (`mapPeripheralIdentifier`,
  `isrUnsafeOperations`, `setupInitCode`, library resolution, profile/cli-metadata
  probing) remain deliberate platform divergences — Zephyr resolves pins through
  chip descriptors, uses `printk` over a DT-chosen console (no `Serial.begin`),
  and has no Arduino-library registry. `snprintf` stays unsupported by design
  (raw escape hatch).

### Patch Changes

- @typecad/safety@1.0.0-alpha.11
- @typecad/ui@1.0.0-alpha.11

## 1.0.0-alpha.10

### Minor Changes

- c7ea1b5: ## cuttlefish create: framework catalog + create-time dependency install

  Reworks the create/install flow:

  - Moves the framework catalog + board→framework compatibility out of
    `src/install/` into `src/create/framework-catalog.ts` — the single source of
    truth for which `@typecad/framework-<id>` packages exist and which are
    compatible with a given board architecture. Deliberately side-effect-free
    (only lockfile/package.json reads) so it unit-tests cleanly.
  - `cuttlefish create` now installs the new project's dependencies as its final
    step (`src/create/install-deps.ts`), detecting the package manager
    (npm/yarn/pnpm) from the invoking directory — so a pnpm/yarn user gets their
    tool of choice even though the new project has no lockfile yet, and the
    scaffolded project is ready to build with no separate `npm install`.
  - The init wizard's framework selection uses the catalog.

  (The earlier `cuttlefish install` command landed in alpha.9; this reworks its
  internals into `create/` and adds the create-time dependency install.)

### Patch Changes

- @typecad/safety@1.0.0-alpha.10
- @typecad/ui@1.0.0-alpha.10

## 1.0.0-alpha.9

### Minor Changes

- a27476a: ## New `cuttlefish install` command

  Adds a `cuttlefish install [framework] [--board id] [--dry-run]` subcommand that
  installs a `@typecad/framework-*` package into the current project. It asks
  which board to target, narrows the framework choices to the ones compatible
  with that board (arduino / zephyr / native), detects the package manager
  (npm / yarn / pnpm) from the lockfile, and runs the install — or prints the
  resolved command with `--dry-run` for CI / scripting. The init wizard's
  "no framework found" error now points users at `cuttlefish install` instead of
  a manual `npm i`.

### Patch Changes

- @typecad/safety@1.0.0-alpha.9
- @typecad/ui@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/ui@1.0.0-alpha.8
- @typecad/safety@1.0.0-alpha.8

## 1.0.0-alpha.7

### Minor Changes

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

### Patch Changes

- Updated dependencies [0320018]
  - @typecad/ui@1.0.0-alpha.7
  - @typecad/arduino-cli@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.6
  - @typecad/ui@1.0.0-alpha.6

## 1.0.0-alpha.5

### Minor Changes

- ## framework-avr: gate native driver shims on actual peripheral usage

  framework-avr previously emitted ~400 lines of uncalled native driver code
  (UART, SPI, TWI/I2C, EEPROM, tone, millis Timer0 ISR, delay/map/constrain
  helpers, and two unreferenced headers) for every AVR program — even a trivial
  `led.toggle()`. For the demo this was 417 lines / 800 B flash; it is now
  28 lines / 140 B flash and contains only what the program uses.

  ### Usage-gated shim emission

  Mirrors framework-arduino's post-hoc filtering model: each native shim block
  carries stable `CUTTLEFISH_*_BEGIN/END` markers, and the shared setup emitter
  strips unused blocks based on `programAnalysis` flags. The AVR strategy also
  self-gates on the same flags (defensive default: emit when no analysis is
  available, preserving direct-strategy unit-test behavior).

  New analysis flags in `program-analysis.ts` (`usesUart`, `usesSPI`, `usesI2C`,
  `usesEEPROM`, `usesTone`, `usesMap`, `usesConstrain`, `usesNativeTiming`) detect
  usage through structured HAL-op names, lowered callees, and raw-code references
  — covering the HAL resolver's lowering paths that the pre-existing regex scans
  missed. `usesNativeTiming` derives the comprehensive gate for the millis ISR
  (direct calls + setInterval/setTimeout + async + UI tick).

  ### framework-arduino: on-demand `<avr/wdt.h>`

  Also fixes a related leak in framework-arduino: `<avr/wdt.h>` was a forced
  include for every AVR program. It is now added on demand by the setup emitter
  when the program actually references `wdt_*` symbols (detected via `wdt.`
  hal-ops), using the same post-hoc filter pattern.

### Patch Changes

- @typecad/ui@1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- ## cuttlefish licenses + doctor: license compliance auditing

  New CLI commands for environment verification and license compliance auditing of
  Arduino dependencies.

  ### `cuttlefish licenses [--all] [--strict]` (new)

  Audits the SPDX licenses of the Arduino libraries a project depends on, with
  copyleft risk classification. Resolves each library's license from
  `library.properties` → `LICENSE` file → source-header comment, normalized via a
  static SPDX table (MIT, BSD-2/3, Apache-2.0, LGPL-2.1/3.0, GPL-2.0/3.0,
  AGPL-3.0, Unlicense, CC-BY/SA/NC-4.0, including `-only`/`-or-later` variants).

  **Project-scoped by default.** Resolves the project's library set from the
  generated `.ino`'s `#include` directives (authoritative — exactly what
  arduino-cli links), with a config-derived display/touch fallback when no `.ino`
  exists. `--all` restores system-wide scanning of every installed library.

  **Four-layer header resolution** (project scope), in order:

  1. User libraries (`arduino-cli lib list`) → resolved with license
  2. Core-bundled libraries (the project's own board core, derived from the FQBN
     via `arduino-cli config dump`) → resolved with license (e.g. `Wire` →
     `LGPL-2.1`, read from its header notice)
  3. Toolchain headers (`avr/*.h`, `util/*.h` from avr-libc) → gray
     `CORE/TOOLCHAIN` row, not flagged as missing
  4. Not installed → red `NOT INSTALLED` (the actionable missing-dependency case)

  Output sorts worst-first: strong copyleft `[COPYLEFT]`, weak copyleft
  `[weak copyleft]`, permissive `✓`, then unknown `UNKNOWN`. `--strict` exits
  non-zero on unknown licenses or missing dependencies (CI-enforceable).

  ### `cuttlefish doctor` (new)

  Verifies `arduino-cli` is installed and the board core for the configured
  `buildTarget` (FQBN) is present, with the exact `arduino-cli core install`
  command to fix a missing core.

  ### Resolver + detection improvements

  - **Library name normalization**: bare import specifiers with underscores
    (`Adafruit_ILI9341`) now correctly resolve to libraries whose arduino-cli
    name uses spaces (`Adafruit ILI9341`), instead of falling back to a
    PascalCase header guess. Fixes `licenses` falsely reporting libraries as
    not-installed.
  - **Broadened license detection** for real-world Arduino libraries: British
    `LICENCE.txt` spelling, `LICENSE` under `src/`, source-header comment scanning
    (the Adafruit pattern), short-form markers (`BSD license`, `Apache License`),
    and the `SPDX-License-Identifier:` marker with `-only`/`-or-later` suffixes.
  - **Project-local header exclusion**: headers co-located with the `.ino`
    (cuttlefish-emitted polyfills) are recognized as project code, not missing
    libraries.

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.4
  - @typecad/ui@1.0.0-alpha.4

## 1.0.0-alpha.3

### Minor Changes

- ## framework-avr: full bare-metal framework

  The `@typecad/framework-avr` package is now a complete, production-ready
  framework for native AVR register-level code generation. It went from an
  unmaintained stub to a fully-featured framework at parity with
  `@typecad/framework-arduino`.

  ### Native register lowering (55 HAL ops)

  Every hardware peripheral is lowered to direct register access — no HAL op
  falls through to Arduino Wiring calls:

  - **GPIO** (PORT/DDR/PIN), **PWM** (OCRnx), **ADC** (ADMUX/ADCSRA)
  - **Timing** (Timer0 overflow ISR + fractional millis), **Interrupts** (EICRA/EIMSK)
  - **Tone** (Timer2 CTC + GPIO toggle), **Pulse/Shift** (micros + GPIO loops)
  - **SPI** (SPCR/SPSR/SPDR), **UART** (USART0), **I2C/TWI** (TWBR/TWCR/TWDR)
  - **EEPROM** (avr-libc `eeprom_read_byte`/`eeprom_write_byte`)

  ### Chip-descriptor portability

  Pin/register mapping is data-driven via `AVRChipDescriptor`. ATmega328P
  (Arduino Uno/Nano) and ATmega2560 (Arduino Mega 2560) descriptors included.
  Adding a chip is a data file, not strategy code.

  ### Bare-metal main() — 72% Flash reduction

  Defining `int main(void)` prevents the Arduino core from being linked,
  yielding dramatically smaller binaries:

  - Minimal pin toggle: **198 bytes** (vs 712 bytes with framework-arduino)
  - Demo (pins + I2C + SPI + timers): **724 bytes** (vs 2.5 KB)

  ### Pluggable OutputShim in @typecad/expect

  The test framework now accepts a pluggable output shim instead of
  hardcoding `Serial.print`. framework-avr provides `avrUartShim` that
  routes test protocol through native `_uart_*` helpers, so test builds
  are fully bare-metal too.

  ### Additional changes across packages

  - `@typecad/cuttlefish`: added `filterRequiredIncludes()` to
    `PlatformStrategy` so frameworks can strip stale HAL includes
  - `@typecad/expect`: `OutputShim` interface, `serialShim`/`avrUartShim`
    built-ins, `ResolvedConfig.framework` field threaded through config
  - All packages: version-aligned at 0.1.0-alpha.3

### Patch Changes

- @typecad/ui@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Fix `requireUIHook()` throwing on builds in projects that do not install the
  optional `@typecad/ui` package.

  After the UI-engine extraction, several call sites in cuttlefish core called
  `requireUIHook()` unconditionally instead of guarding with `hasUIHook()`. In a
  project without `@typecad/ui`, the dynamic import in `loadUIEngine()` fails
  gracefully and leaves the hook null (by design), so the first unguarded call
  threw `Error: UI hook is not registered...` on every build — including plain
  non-UI sketches like the starter blink project.

  Guarded all unconditional call sites with `hasUIHook()` so they no-op when the
  UI engine is absent, restoring the documented "UI is optional" contract:

  - `cli.ts` — UI type-declaration generation (build and watch-rebuild paths)
  - `transpile.ts` — parser-warning and mount-diagnostic loops
  - `orchestrator/type-checker.ts` — UI module registration

  Also added two helpers to `ui/ui-bridge.ts` (re-exported via
  `@typecad/cuttlefish/testing`) so the test suite can reproduce a project that
  has not installed `@typecad/ui`:

  - `resetUIEngine()` — clears the bridge's `loaded` flag and hook, mirroring the
    other `reset*` session helpers (`clearCaches`, `resetDisplayProfile`).
  - `__simulateUIAbsentForTest()` — forces the "import attempted, hook null"
    state, since the monorepo test environment otherwise eagerly registers the
    engine and masks this regression.

  Added a regression test (`tests/packages/transpiler/optional-ui-no-engine.test.ts`)
  covering both the type-check-skipped and type-check-enabled transpile paths
  with the UI engine absent.

  - @typecad/ui@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.

### Patch Changes

- Updated dependencies
  - @typecad/ui@0.1.0-alpha.1
