# E-Ink Display Support — Research & Design Discussion

**Status:** Research / feasibility discussion (not an approved spec)
**Date:** 2026-07-02
**Scope:** How the cuttlefish transpiler / demo-ui could support e-ink panels
(1-bit, multi-color, grayscale), and the compounding issues that arise.

## Context — how the system works today

The system transpiles HTML+CSS into Arduino C++ that renders on TFT hardware.
Three extension seams already exist and are the load-bearing points for any
e-ink work:

1. **Display adapter registry** (`packages/cuttlefish/src/api/shared/display-adapter.ts:47`)
   — `registerDisplayAdapter("driver-name", gen)`. Only ILI9341 is registered.
   The runtime never names a display class; it calls `display_init`,
   `display_writePixels`, `display_startWrite`/`endWrite`, etc. An e-ink
   backend is architecturally welcome.

2. **`colorFormat: "rgb565" | "mono"`** (`api/shared/display-profile.ts:49`)
   with `toMono()` + `resolveColor(input, "mono")` already in
   `packages/cuttlefish/src/ui/color.ts:181`. But it is barely wired: the
   preview forces `"rgb565"` regardless (`preview/host-ui-runtime.ts:99-103`),
   and the runtime header is `uint16_t`/RGB565 throughout. Mono today only
   disables font AA. The plumbing exists; the behavior is a stub.

3. **`@media` is a transpile-time variant selector**
   (`ui/css-parser.ts:163`, `evalMediaCondition`). The comment is explicit:
   *"Each firmware build targets ONE display size, so @media is a compile-time
   variant selector, not responsive design."* It currently only knows
   width/height. This is the natural home for `@media (e-ink)` /
   `(update: slow)` / `(monochrome)`.

## The central tension

The system is tuned for the opposite of e-ink on two axes:

| Axis | TFT assumption (today) | E-ink reality |
|---|---|---|
| **Color** | RGB565 + antialiasing + gradients, resolved once at transpile | 1-bit, or 3–7 discrete levels; intermediate values dither to noise or staircase |
| **Refresh** | Immediate-mode fast SPI; clears whole screen on navigate/keyboard; throttle is a *draw-rate* gate | 1–15 fps partial, 1–2 s full "flash"; full clear = a visible white-out; bistable (holds image with no power) |

The genuinely hard parts are not color or CSS — those have clean seams.
The hard parts are **refresh** and the **compounding behaviors** built on the
fast-refresh assumption.

---

## Challenge 1 — Reduced color palette

**Where color lives:** `color.ts:186 resolveColor(input, format)` runs once at
transpile time. Every node's `bg`/`fg`/`borderColor`/`gradientColor1/2` becomes
a baked `uint16_t` literal. The device never converts color.

Palette mapping at the **node level** is easy (snap each color to the nearest
of N levels) but produces flat, banded output. Good e-ink output needs
**dithering** (ordered/Bayer or error-diffusion), and dithering is inherently
spatial/per-pixel — it depends on neighboring pixels, so it cannot happen when
a single node's color is resolved. It must happen at the
**framebuffer→display boundary**.

> **E-ink effectively requires a backing store.** The TFT runtime draws
> directly to the panel (and `UI_USE_FULL_FRAMEBUFFER` is off by default,
> `runtime-header.ts:31-33`) precisely because a full framebuffer makes small
> updates look like a flash on SPI. Dithering needs a region of composed
> pixels to quantize. So the e-ink path needs the opposite default: compose
> into a buffer, dither, then push. This **inverts** the AGENTS.md guardrail
> "Do not enable full-screen framebuffer rendering by default to hide
> tearing" — that is a TFT rule; e-ink requires the buffer.

**Palette levels:** the descriptor should declare how many levels per channel
(1-bit = 2; 4-gray = 4; 7-color = 7×1, etc.). `color.ts` snaps node colors to
the nearest level for flat fills (cheap, no dithering); the push pass
optionally dithers photos/gradients/AA edges to those same levels.

**AA/gradients/opacity:** `ui_blend565` (`runtime-header.ts:2441`) is the
heart of opacity, shadows, gradients, AA text and produces many intermediate
grays. Clean story: keep `ui_blend565` as-is producing RGB565 into the buffer;
let the dither pass at push reduce it to panel levels. That keeps the runtime
untouched and concentrates palette logic in one place. `UI_AA` is already
profile-gated and easy to disable.

---

## Challenge 2 — Slow render speeds

Three sub-problems:

**(a) No partial-refresh concept exists.** The runtime has per-node `dirty`
bits and computes `ui_node_paint_rect` / `ui_subtree_current_paint_rect` — it
knows what changed and where — but draws each dirty node **immediately to the
display target** and never aggregates. For e-ink you need the missing
aggregation step: union the paint rects of everything drawn this frame →
issue **one** partial refresh of the union. The information is already
computed; the batching step is absent.

**(b) Full-screen clears on routine events.** `ui_navigate()` →
`display_fillScreen(0x0000)` (`runtime-header.ts:440`); keyboard open/close
marks the whole tree dirty. On e-ink each is a full-screen flash. These need
to become "mark everything dirty and let the next frame's partial refresh
repaint it" — or for true screen changes, an explicit, opt-in full refresh
the author requests.

**(c) Ghosting.** E-ink accumulates residual charge; partial refresh alone
leaves faint old images. Real e-ink UIs do a periodic "cleaning" full
refresh. No concept exists today — needs a refresh scheduler that counts
partials and occasionally triggers a full clear, plus a `clear-ghost`
affordance.

The right model is a **refresh scheduler** behind the `display_*` boundary:
accumulate dirty rects during a frame; at frame end pick partial (fast, leaves
ghosting) vs full (slow, clean) per region; enforce a refresh budget that
coalesces rapid updates. This is the biggest net-new subsystem. The TFT path
does not need it (the panel is immediate), so it lives in the e-ink adapter +
a thin frame-end hook.

---

## Challenge 3 — CSS selectors — `@media (e-ink)`

This part is easy and clean. `evalMediaCondition` (`css-parser.ts:163`) is a
transpile-time variant selector keyed off the display profile. Adding e-ink:

1. A new field on `DisplayProfile` (e.g. `displayClass: "tft" | "eink"`, or
   reuse/extend `colorFormat`) — the source of truth.
2. Teach `evalMediaCondition` to recognize `(e-ink)`, `(update: slow)`,
   `(monochrome: N)`, reading that field.
3. Authors write:
   ```css
   .card { background: #1a73e8; box-shadow: 0 2px 8px black; }
   @media (e-ink) {
     .card { background: white; border: 2px solid black; box-shadow: none; }
   }
   ```
   The non-e-ink rule drops out at transpile; the e-ink build keeps the second.
   One stylesheet, two firmware images.

The existing **theme-class** mechanism (`.eink { --bg: #fff }` +
`themeClass: "eink"`) already works as a manual escape hatch. Supported
pseudo-classes are `:pressed :disabled :checked :focus` only — **no `:hover`**
(e-ink would not have hover anyway; the model is press/state-oriented, which
suits e-ink).

---

## Challenge 4 — Compounding issues (the ones that bite)

1. **Scrolling assumes fast refresh.** `shiftListViewport`
   (`host-ui-runtime.ts:1927`) does `copyWithin` + repair-exposed-strip per
   drag frame; the C++ runtime keeps a persistent shifted canvas with
   rubber-band physics. E-ink wants **paged/instant scroll** (jump N rows, one
   refresh) — a different `ScrollInputTier`/`ScrollRenderTier`. The tier system
   exists (`display-profile.ts:101-105`); e-ink needs new tier values or a new
   axis.

2. **Animations/transitions.** `lerp_color` (`runtime-header.ts:239`) and
   keyframes assume 60fps interpolation. A 2s color fade queues ~120
   refreshes. E-ink needs snap or a few discrete steps. Render-tier rule:
   "animations collapse to endpoints on `update: slow`."

3. **Preview/runtime parity.** The preview is an instant `putImageData` blit,
   forces RGB565 even for mono profiles, and its only mono behavior is
   disabling AA text. To be useful, the preview must simulate e-ink: show
   reduced palette/dithering and refresh latency / a "flashing" state. Per
   AGENTS.md, preview and runtime must agree — required, not optional polish.

4. **`uint16_t` pervasiveness.** ~80 struct fields, image data
   (`const uint16_t*`), all primitives. Forking the type system is invasive
   and risks the "no per-frame allocation" guardrail. Keeping RGB565 internally
   and quantizing at the boundary sidesteps this.

---

## Multi-color e-ink (BWR / 7-color)

Two families with different refresh profiles:

- **3-color (BWR / BWY):** black + white + red (or yellow). Very common
  (WaveShare 2.9"/4.2" BWR). Constraint: almost always full-refresh-only, and
  the red waveform is slower than B/W — a full redraw can take 15–30s.
  Partial refresh, when it exists, is B/W only. Red is expensive in *time*,
  not just scarce in *palette*.
- **7-color (ACeP / Spectra 6 / Gallery):** a fixed set of ~7 inks. Full
  refresh only, very slow (up to ~60s). No partial refresh. Closer to a
  heavily-reduced-palette color display.

The kicker both share: **color is no longer decorative.** On BWR e-ink, red is
scarce and slow, so using it well means reserving it for things that earn it.

### Color as semantic bandwidth

The highest-value use of a third color is **semantic emphasis**, not
aesthetics. Red = danger/delete/error/negative. This maps onto the
pseudo-classes the system already supports (`:pressed`, `:checked`,
`:disabled`, `:focus`):

```css
@media (e-ink) {
  .row { color: black; }
  .row.danger   { color: red; }                  /* deletion, destructive actions */
  .stat.negative{ color: red; }                  /* negative balances, deltas */
  .badge.unread { background: red; color: white; } /* unread marker */
  .row:checked  { background: red; color: white; } /* selection — no hover, so this carries it */
}
```

No `:hover` on e-ink (and the model is press/state-oriented already), so the
accent lands on *state* rather than *interaction*. That is the right fit.

### The mapping problem

An author's CSS blue (`#1a73e8`) does not map to a BWR red by nearest-luminance
— it snaps to black. So you need a deliberate mapping. Three mechanisms, all
worth offering:

1. **Explicit panel-color authoring** — predictable, lowest magic. Snapping is
   nearest-color-in-palette so hex values land safely. Make this primary.
2. **Palette-aware snapping** — declare panel palette; every CSS color snaps
   to the nearest ink. Works for "I don't want to think about it" but cannot
   force "this blue should read as red."
3. **Semantic roles** — the powerful one. The system already has CSS variables
   + theme classes. A role is a named variable with an intent, and the palette
   maps intents → inks:
   ```css
   @media (e-ink) {
     :root { --ink-fg: black; --ink-bg: white; --ink-accent: red; --ink-muted: black; }
     .danger { color: var(--ink-accent); }
   }
   ```
   One stylesheet can target BWR (`--ink-accent: red`) and 7-color
   (`--ink-accent: orange`) by swapping the role→ink map without rewriting
   component rules. This is what makes "general framework" tractable.

### Apparent extra colors via halftone

Not limited to 3 raw inks — ordered dithering/stippling trades resolution for
apparent tones, and generalizes to multi-ink palettes:

- Red + white stipple at varying density → pink through salmon. So a red→white
  gradient (`ui_draw_gradient_fill` already produces one) dithers into a fading
  red haze rather than a hard band.
- Red + black halftone → maroon/dark-red.
- A 3-color panel can show ~5–6 apparent colors at the cost of texture.

Error-diffusion (Floyd–Steinberg) over multiple inks is the higher-quality
option; ordered (Bayer) is the cheap/no-allocation option the runtime
guardrails prefer. Same dither pass as the 1-bit case, just with a multi-ink
palette. Caveat: halftone texture can look noisy on low-DPI e-ink, and the
AGENTS.md clip-before-expensive-work / no-per-frame-alloc rules mean the dither
pass runs into a persistent buffer with the dirty region culled.

### The compounding tradeoff: red is slow

- **Full-refresh-only.** Most BWR/7-color panels cannot partial-refresh color
  regions. The refresh scheduler becomes "full refresh, rarely" rather than
  "partial refresh, often."
- **Red regions refresh slower than B/W.** A mostly-red screen update is
  visibly slower. Reinforces the semantic-bandwidth framing: don't bathe the
 screen in red; use it as a scarce accent, partly for speed reasons.
- **Animations are essentially dead.** A color cross-fade is multiple seconds
  of flashing. `lerp_color`/keyframes snap to endpoints on `update: slow`
  regardless of palette; color panels make that snap more important.

Practically: 1-bit might still attempt smooth-ish paged scroll. BWR almost
certainly wants **static, event-driven redraws** (tap → repaint one region →
full refresh once). A stricter render tier.

---

## Three approaches

All share the easy wins (palette descriptor, `@media (e-ink)`, e-ink adapter
registration, theme-class escape hatch). They differ on how deep the
refresh/color change goes.

**Approach A — Boundary quantization + deferred refresh backend (recommended).**
Keep RGB565 internally everywhere — do not touch the ~80 fields or
`ui_blend565`. Add: (1) a palette descriptor on `DisplayProfile`; (2) per-node
color snapping at transpile; (3) an **always-on backing store** for e-ink
(compose into it, since e-ink needs it for dithering anyway); (4) a **dither
pass at push** that reduces the RGB565 buffer to panel levels; (5) a **refresh
scheduler** behind `display_*` that aggregates dirty rects and chooses partial
vs full refresh. Preview gains an e-ink simulation mode. Trade-off: two
rendering models (direct-to-panel for TFT, buffered+dithered+scheduled for
e-ink), but the TFT path is untouched and AGENTS.md guardrails stay intact.

**Approach B — Native palette-aware runtime.** Make `colorFormat` first-class:
a color type that is RGB565 *or* palette-index, forked blend/lerp/AA/gradients
with mono/grayscale variants, palette-indexed image data. Trade-off: most
"correct," touches everything, highest risk to the stable TFT path and the
no-allocation guardrail. Biggest blast radius.

**Approach C — Capability-descriptor core, ship 1-bit first.** Same descriptor
as A, but scope the first cut to 1-bit B&W with partial refresh only (no
dithering, no grayscale, animations snap). Fastest to real hardware on the
cheapest/most-common panels, with the descriptor designed to extend to
grayscale/color later. Trade-off: photos/gradients look poor until dithering
lands; rework seam when grayscale is added.

**Recommendation: A.** The backing-store requirement is *forced* by dithering
regardless of approach (cannot dither without a region), so the buffering is
not optional complexity — it is the cost of good e-ink output. Keeping RGB565
internal means the stable TFT runtime and its guardrails stay untouched, and
the entire e-ink delta lives behind the `display_*` seam + one frame-end hook +
`color.ts` + `css-parser.ts`. C is a fine way to *stage* A.

---

## Decisions captured from discussion

- **Panel class scope:** general framework — handle 1-bit, grayscale, and
  multi-color e-ink via a palette/refresh capability descriptor.
- **CSS targeting:** `@media (e-ink)` feature query (extend
  `evalMediaCondition`), with the existing theme-class mechanism retained as
  a manual escape hatch.
- **Engagement model:** discussion first; spec only if the design holds up.

## Open questions before a spec

- Confirm Approach A (RGB565 internal, buffer+dither+schedule at boundary) vs
  native-palette (Approach B).
- Scroll/animation behavior on e-ink: snap to endpoints, or stepped/chunky
  transitions?
- Whether semantic roles (intent → ink) should be part of the v1 design or a
  follow-on.
