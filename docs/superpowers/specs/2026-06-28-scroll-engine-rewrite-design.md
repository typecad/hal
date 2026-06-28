# Scroll engine rewrite — unified, smooth, capability-driven

**Date:** 2026-06-28
**Status:** Approved (Sections 1–6)
**Scope:** Remove all existing scrolling behavior in the cuttlefish UI runtime
(`packages/cuttlefish/src/ui` + `packages/cuttlefish/src/preview`) and the
`@typecad/ui` demo, and replace it with one unified, capability-driven scroll
engine. Public API (`ui.bindList`, CSS `overflow`, `<list item-height>`) is
**unchanged**.

## Problem

Scrolling in `demo-ui` feels completely broken. Concrete, measured causes
(verified against the current source):

1. **Device scrolls 3× too fast.** `UI_SCROLL_DRAG_MULTIPLIER 3`
   (`runtime-header.ts:37-38`) makes content move three times faster than the
   finger — the opposite of "scroll at the rate the touch moves."
2. **It can't reach a boundary gracefully.** Content is hard-clamped to
   `[0, maxScroll]`, then snaps to top within `UI_SCROLL_EDGE_SNAP_PX 12`. No
   overscroll, no bounce-back.
3. **Dead on lift.** Motion stops the instant the finger lifts. No settle.
4. **Preview and device disagree.** Preview drag is 1:1; device is 3:1. The
   browser can't be used to tune what the device does.
5. **Two engines, hand-mirrored.** The C++ runtime (`runtime-header.ts`) and
   the JS preview (`host-ui-runtime.ts`) duplicate all scroll logic and must be
   kept in sync by hand.
6. **Two scroll mechanisms sharing one gesture.** Generic `overflow: scroll`
   containers and the special `<list>` element have separate state tables and
   separate draw paths, kept from double-counting by a single shared drag
   baseline (a documented fix for a prior double-delta bug).

### Why `<list>` is smooth and containers are not

Decisive finding from the current source:

- **The list** applies the drag delta **immediately and directly** to `scrollY`
  every frame (`runtime-header.ts:2076-2088`) and redraws **only the visible
  rows** (`runtime-header.ts:3724-3738`). Cheap work, every frame, no gating.
- **The container** *accumulates* `__ui_scroll_pending_dy` and only redraws when
  the accumulation hits `UI_SCROLL_STEP_PX` **and** 16 ms has elapsed
  (`runtime-header.ts:2068-2073`), then does expensive off-screen canvas
  compositing (`__ui_scroll_cache_*`). Batched, cadence-gated, heavy compositing
  → discontinuous feel.

**The list's smoothness is the floor this rewrite must meet or beat.** The new
engine adopts the list's immediate-apply, per-frame, redraw-only-visible model
as the **default for all scrolling.** Containers are promoted *up* to it; the
list is not pushed down.

## Decision summary (from brainstorming)

- **Q1 — Tracking:** 1:1 with **light input smoothing** (low-pass + deadband)
  so steady-state still tracks the finger exactly but resistive-touch jitter is
  suppressed.
- **Q2 — Overscroll:** **Both** — rubber-band elastic excursion while dragging
  **and** snap-to-boundary on release.
- **Q3 — Fling:** **None.** Motion exists only while the finger is down. Lift =
  stop (plus the bounded bounce-back/snap). Removes a whole failure surface on
  the MCU.
- **Q4 — Fallback:** **Two axes** — input quality (capacitive → resistive →
  none) and frame/refresh budget (full → constrained). Each degrades
  independently. Preview always runs the full path.
- **Q5 — Scope:** **Unify into ONE scroll model.** `<list>` becomes a scroll
  container whose children are virtualized. One `scrollY`, one physics loop, one
  draw-time offset, one gesture baseline. Kills the dual-mechanism fragility and
  the 4-list cap.
- **Q6 (Section 6):** **No `ui.scrollTo`** — public API strictly unchanged for
  this spec. **`overrideProbes: true`** — config-declared capabilities are
  deterministic; runtime probes are opt-out (off by default).
- **Approach:** **2 — Capability-driven layered engine.** Three swappable
  layers per node (Input / Physics / Render), each selected by platform
  capability.

## Architecture

A single scroll engine per scroll container. `<list>` is a scroll container
whose children are virtualized — same engine, same gesture, same render loop.
Three layers, selected per platform:

| Layer | Responsibility | Capacitive / preview | Resistive (this ESP32) | None / constrained |
|---|---|---|---|---|
| **Input** | raw touch → smoothed `dy` | passthrough 1:1 | low-pass + deadband | discrete (buttons / encoder / scrollbar-thumb) |
| **Physics** | `dy` → offset (clamp + rubber-band + snap; no fling) | identical | identical | hard-clamp + instant snap (no elastic visual) |
| **Render** | offset → pixels | Mode A/B, animated rubber-band | Mode A/B (default) | Mode C (direct-partial, no canvas) |

### Two engines, kept simpler and identical

The C++ runtime (`runtime-header.ts`) and the JS preview
(`host-ui-runtime.ts`) each implement the same engine. Both are *less* code than
today (no accumulation, no cache compositing, no dual state tables). The only
intentional divergence is the **input layer**: preview = capacitive/passthrough;
device = the declared input tier.

## Section 1 — Removal scope

### Removed (broken behavior & dual-mechanism fragility)

- `__ui_scroll_node`, `__ui_scroll_pending_dy`, `__ui_scroll_snap_top`,
  `__ui_scroll_start_y`, and all `__ui_scroll_cache_*` statics
  (`runtime-header.ts:185-195`).
- `__ui_list_drag`, `__ui_list_snap_top`, `__ui_list_start_y` list-gesture
  statics.
- The 3× multiplier (`UI_SCROLL_DRAG_MULTIPLIER`), the 12 px snap, the 2 px
  deadband **as magic numbers** (the deadband survives only inside the resistive
  input filter — Section 6).
- The **cadence-gated accumulator path** — `__ui_scroll_pending_dy`
  accumulation + `UI_SCROLL_STEP_PX` / `UI_SCROLL_FRAME_MS` redraw gating
  (`runtime-header.ts:2068-2073`). This is the direct cause of container
  jerkiness. The list's immediate-apply path is the survivor.
- The **off-screen scroll-canvas compositing** machinery: `ui_invalidate_scroll_cache`,
  `ui_invalidate_scroll_cache_for_node`, `ui_get_scroll_canvas_keep_cache`,
  `ui_get_scroll_canvas`, `ui_scroll_should_buffer`,
  `ui_get_scroll_repaint_canvas`, `ui_shift_scroll_canvas`
  (`runtime-header.ts:548-630`, ~80 lines). Replaced by the simpler per-node
  canvas strategy in Section 3.
- The separate `UIListState` table and its hard cap of 4 lists
  (`__ui_lists[4]`, `runtime-header.ts:294`). List state moves onto the node.
- The two separate hit-scans in `ui_touch_down` (scrollable containers vs list
  nodes, `runtime-header.ts:1833-1865`) collapse into one.
- All parallel copies of the above in `host-ui-runtime.ts`.
- Redundant inline `overflow="scroll"` on `<list>` in the demo HTML (`<list>` is
  a scroll container by default via the UA stylesheet).

### Kept (sound rendering primitives)

- The draw-time offset trick: `ui_base_draw_y_for_node` subtracting each
  scrollable ancestor's `scrollY` (`runtime-header.ts:1093-1101`, preview
  `host-ui-runtime.ts:668`). This is *how* scroll offset becomes pixels.
- The scrollbar drawing, hit-testing-by-scroll-clip, and dirty-marking
  primitives (`ui_mark_dirty`, `ui_mark_subtree_dirty_local`, clip-by-scroll
  tests). Reused by the new engine.
- `ui.bindList`, the `<list>` element, `item-height`, and the **virtualization
  draw path** (`drawListNode`, `runtime-header.ts:3700-3763`) — the proven-smooth
  path that becomes the model for the new generic render layer, not a deletion.

## Section 2 — Unified scroll engine (core model)

### Node model change

Today a node has `scrollable` + `scrollY` + `contentHeight`, and lists live in a
separate `UIListState` table. New fields on `UINode`:

| Field | Type | Role |
|---|---|---|
| `scrollable` | bool | clips children & participates in scroll |
| `scrollY` | int16 | the single scroll offset (draw-time) |
| `contentHeight` | int16 | total child height (clamp + scrollbar) |
| `virtualized` | bool | children produced by callbacks, not static nodes |
| `listItemHeight` | int16 | row pitch (virtualized only) |

A generic `overflow: scroll` container: `scrollable=1, virtualized=0`. A
`<list>`: `scrollable=1, virtualized=1, listItemHeight=N`. **No `UIListState`
table, no 4-list cap.** The list's binding (count / item / tap functions) moves
onto the node as three function pointers, read at draw time. One source of truth
per node.

### Per-frame loop

```
INPUT    touch sample → input layer → smoothed delta (dy)
PHYSICS  dy + current scrollY → clamped/overscrolled offset (rubber-band)
RENDER   offset → pixels (list-style immediate redraw of this node + visible children)
```

Every scroll container adopts the list's immediate-apply model as default:
apply `dy` directly to `scrollY` (subject to physics), mark the node dirty,
redraw that node's subtree on the next paint. **No accumulation, no cadence
gate, no pending buffer.**

- Virtualized nodes (`<list>`): redraw only visible rows (unchanged).
- Static `overflow: scroll` containers: redraw the visible portion of the
  subtree. Strategy in Section 3.

### Gesture

Single baseline. One `__ui_drag_start_y`, one owning node per gesture
(`__ui_scroll_node`), found by one hit-scan that treats scroll containers and
lists uniformly. The double-delta bug class is gone because there's no longer a
second mechanism to double-count against.

## Section 3 — Render strategy

Three render modes, selected by the render layer (capability, Section 5) and the
per-node situation:

### Mode A — Virtualized (lists)

Unchanged from today. Redraw only rows in `[first, last]` into a viewport-sized
canvas, push it. Already cheap — this is the floor.

### Mode B — Shift-and-repair (default for static containers)

The insight: when scrolling, *most already-drawn pixels are still correct, just
moved by `dy`.*

1. Each scroll container has a **viewport-sized RAM canvas** (`bw × bh`, lazily
   allocated — same pattern the list uses today, `display_createCanvas`).
2. On a scroll frame with delta `dy`:
   - **memmove** the canvas buffer vertically by `dy` (cheap RAM op) — relocates
     existing pixels.
   - **Redraw only the newly-exposed strip** (height `|dy|`): walk children,
     redraw each whose scroll-adjusted `[y, y+h]` intersects the exposed strip,
     clipped to that strip. For typical small `dy`, a thin row of work.
   - **Push** the canvas (full region) to the display.
3. On a non-scroll repaint (the container's own children changed): full redraw
   into canvas, then push.

For small per-frame `dy`, Mode B is a memmove + a thin strip redraw — that's the
smoothness mechanism. It makes a complex container as cheap per-frame as a list.

### Mode C — Direct-partial (fallback: low-RAM / low-frame-budget)

Where a viewport canvas doesn't fit (e.g. 2 KB-SRAM AVR — a full canvas is
impossible) or the platform can't sustain per-frame pushes, drop the canvas:
redraw the exposed strip **directly to the display**, accepting that
already-pushed pixels can't be shifted so more must be redrawn. Less smooth, but
works and stays within budget. This is the graceful render-side degradation.

### Verified display-shim facts

- The ILI9341 has hardware vertical-scroll (`scrollTo` + `setScrollMargins`,
  `Adafruit_ILI9341.h:149-150`) — but it scrolls the *whole active area* with
  only top/bottom fixed margins. It **cannot** serve a mid-screen container
  between a fixed header and footer, so the design does **not** use it.
- `drawBitmap` + `writePixel` exist; **no `readPixel` / `readRect`** on an SPI
  ILI9341 — already-pushed pixels can't be cheaply read back. This is why Mode B
  operates on a **local RAM canvas**, not on the display framebuffer.

### RAM budget

A full-viewport GFXcanvas16 is `w × h × 2` bytes. ESP32-WROOM (~520 KB SRAM) can
fit a typical container canvas (e.g. 220 × 250 ≈ 110 KB) — and lists already
allocate comparable canvases today, so this is established, not new. The budget
is exactly why Mode C exists for smaller MCUs.

### Dirty-marking and clip reuse

Existing primitives stay — `ui_mark_dirty`, clip-by-scroll tests, the draw-time
offset (`ui_base_draw_y_for_node`). Mode B's canvas is a new target for the same
draw primitives; Mode A is unchanged. The old `__ui_scroll_cache_*` off-screen
compositing machinery (~80 lines) is deleted entirely.

The recompute-not-latch snap discipline (today's code,
`runtime-header.ts:2059-2066`) carries forward into the physics layer — but it
now governs rubber-band/snap (Section 4), not a snap-top latch, since overscroll
is handled by physics rather than a flag.

## Section 4 — Physics layer (rubber-band + snap, no fling)

Net-new — today there is no physics (hard clamp + 12 px snap). Three
responsibilities, all running **per frame, while the finger is down** (no fling =
nothing animates after lift except the bounded bounce-back).

### State per scroll container

(On the node, replacing the deleted `__ui_scroll_*` statics.)

| Field | Type | Role |
|---|---|---|
| `scrollY` | int16 | committed offset; source of truth for draw |
| `overscrollPx` | int16 | current elastic excursion past a boundary (0 in-bounds; +past top, −past bottom) |
| `settling` | bool | true while a bounce-back / snap animation is in progress |

Gone: `pending_dy`, the cadence gate, the snap-top latch, the cache flags.

### While dragging (input layer hands a smoothed `dy`)

- Compute raw target `next = scrollY − dy`.
- **In-bounds** (`next ∈ [0, maxScroll]`): `scrollY = next`, `overscrollPx = 0`.
  Pure 1:1 — content follows the finger exactly.
- **Overshoot**: clamp `scrollY` to the boundary, and set `overscrollPx` to the
  rubber-band excursion for the *cumulative* drag past the boundary
  (diminishing returns — the further past the edge, the less extra offset):
  ```
  // d = cumulative pixels dragged past the boundary since crossing it (>= 0)
  // r = resulting excursion (the absolute value written to overscrollPx)
  r = maxOverscroll * (1 - 1 / (1 + d / stiffness))
  ```
  `d` is tracked from the moment `scrollY` hits a boundary, reset to 0 whenever
  motion returns in-bounds. `stiffness` is the drag distance at which the
  excursion reaches half of `maxOverscroll`. Content visibly stretches past 0 /
  past max but resists — the forgiving edge. `scrollY` never leaves
  `[0, maxScroll]`; only `overscrollPx` tracks the excursion, so the
  **committed position stays valid** even mid-overscroll.

### On lift (release)

- If `overscrollPx != 0` → enter `settling`, animate `overscrollPx → 0` over a
  short ease-out (the bounce-back). `scrollY` stays clamped at the boundary it
  overshot, so the content springs back to 0 / max exactly.
- Else if `scrollY` is within `edgeSnapPx` of a boundary → enter `settling`,
  animate `scrollY → boundary`. This is the "scroll to 0 without positioning to
  0" case: get within the radius and release, it finishes the trip for free.
- Else: stop. No fling. Motion ends with the finger.

### The settle animation

The *only* post-lift motion, and it is bounded — a fixed short duration (a few
frames), ease-out, terminating at the boundary. It cannot run away or drain the
frame budget. This is what the cadence gate used to fake, badly; here it is a
real, short, purposeful animation with a definite end.

### Capability coupling

Rubber-band resistance and the settle animation run only when the **render
layer** confirms the platform can repaint per-frame (Modes A/B). On a Mode-C
platform the physics layer degrades to **hard-clamp + instant snap**: no elastic
excursion, no bounce animation — just clamp to boundary and snap if within
radius. The physics is identical logic; only the *visual* of the rubber-band is
gated by whether the platform can animate it. Preview always runs the full
elastic path.

### Why no-fling makes this *better*

Bounce-back + edge-snap give the "alive" feel that fling usually provides, but
in a model that is simpler, bounded, and has one fewer thing fighting the
resistive panel's sample rate. Smoothness comes from 1:1 tracking + the render
layer, not from inertia.

## Section 5 — Capability model (two-axis graceful fallback)

Two independent axes; each degrades on its own; preview always runs the full
path.

### Axis 1 — Input quality (selects the input layer)

| Tier | Trigger | Behavior |
|---|---|---|
| **Capacitive** | declared, or preview | Passthrough 1:1 — content tracks the finger exactly, no filter. What the preview always does. |
| **Resistive** *(this ESP32's default)* | `touch.library` = resistive chip (XPT2046 etc.) | The Q1 low-pass + deadband: steady-state still 1:1, but per-sample jitter is smoothed. |
| **None / discrete** | no touch, or encoder/buttons | No drag input — scroll driven by discrete events (button ±, encoder tick, scrollbar-thumb drag). Same physics; only the source of `dy` changes. |

### Axis 2 — Frame/refresh budget (selects the render layer + gates rubber-band visual)

| Tier | Trigger | Render mode | Rubber-band visual |
|---|---|---|---|
| **Full** *(ESP32 default, preview)* | enough SRAM for a viewport canvas + can push per-frame | Mode A (lists) / Mode B (shift-and-repair canvas) | full elastic overscroll + bounce-back animation |
| **Constrained** | small SRAM (can't fit a viewport canvas) **or** can't sustain per-frame pushes | Mode C (direct-partial, no canvas) | degraded: hard-clamp + instant snap, no elastic |

### Where capabilities come from — config is source of truth, probes refine

Pure runtime auto-detection on an MCU is unreliable. The mechanism:

- **Config-declared (primary).** `cuttlefish.config.ts` already declares the
  hardware — `touch.library: 'XPT2046_Touchscreen'`, `minPressure`,
  `spiFrequency`. That declaration *is* the capability statement.
  `XPT2046_Touchscreen` → resistive tier; ESP32 SRAM → full render tier. Defaults
  are derived from the already-declared hardware, so **the existing demo config
  produces a correct engine with zero scroll block added.**
- **Runtime probes (refinement, opt-out by default).** With
  `overrideProbes: false`, over the first few touch events the engine measures
  actual sample interval and jitter; if a declared-resistive panel turns out to
  be unusually clean (≈capacitive) or unusually noisy, it nudges the input
  smoothing level. **Default `overrideProbes: true`** — config-declared,
  deterministic, no on-device surprises. Probes add nondeterminism and are off
  unless explicitly enabled.

### Coupling rule (explicit)

- **Input tier** → only affects smoothing of `dy`. Physics + render unchanged.
- **Render tier** → affects which render mode runs **and** whether the
  rubber-band visual animates (Mode C ⇒ no elastic). Physics logic is identical;
  only the *visual* of the elastic is gated.
- A board can be "resistive input + full render" (this ESP32: filtered touch,
  smooth canvas scroll, full rubber-band) — the profile the current config
  implies. That is the default the demo exercises.

### No speculative multi-MCU matrix

Not a lookup table of "ESP32 does X, AVR does Y, RP2040 does Z." The two axes
cover the real dimensions; a new board declares its tiers and the engine adapts.

## Section 6 — Tunables, config surface & public API

### Physics tunables

All with defaults so the demo runs with zero config. C++ `#define`s (overridable
per-TU, same pattern as today's `UI_SCROLL_*`) and identical JS-preview constants.

| Tunable | Default | Role |
|---|---|---|
| `maxOverscroll` | 40 px | ceiling on rubber-band excursion past a boundary |
| `stiffness` | 0.5 | rubber-band resistance curve (higher = stiffer, less stretch) |
| `edgeSnapPx` | 12 px | radius within which release snaps to boundary for free |
| `settleMs` | 180 ms | bounce-back / snap animation duration (ease-out, bounded) |

The deleted magic numbers (3× multiplier, 16 ms cadence, 1 px step, 2 px
deadband) are gone; the deadband survives only inside the resistive input filter
as `inputSmoothing`.

### Input-layer tunable

| Tunable | Default (resistive) | Role |
|---|---|---|
| `inputSmoothing` | 0.3 (low-pass coef) + 2 px deadband | the Q1 filter; passthrough (0 smoothing) on capacitive/preview |

### `scroll:` config block

Optional; extends the existing `display:` block in `cuttlefish.config.ts`.

```ts
display: {
  // ...existing...,
  scroll: {
    inputTier: 'resistive',     // 'capacitive' | 'resistive' | 'none'
    renderTier: 'full',         // 'full' | 'constrained'
    maxOverscroll: 40,
    stiffness: 0.5,
    edgeSnapPx: 12,
    inputSmoothing: 0.3,
    overrideProbes: true,       // default true: trust declared tiers
  }
}
```

Defaults are derived from the already-declared hardware: `XPT2046_Touchscreen`
⇒ `inputTier: 'resistive'`; ESP32 SRAM ⇒ `renderTier: 'full'`. The block is
validated at build with a clear diagnostic if a tier is impossible (e.g.
`renderTier: 'full'` declared on a board whose SRAM can't fit a viewport canvas).

### Public API — strictly unchanged

- `ui.bindList(node, countFn, itemFn, onTap?)` — unchanged.
- CSS `overflow: scroll` / `overflow: hidden` — unchanged.
- `<list item-height="N">` — unchanged.

**No `ui.scrollTo`** (per Q6) — programmatic scroll is a separate future spec.
The current public surface is exactly the public surface after this change.

### Telemetry hook (non-functional, for tuning)

One optional `#define UI_SCROLL_DEBUG` that, when on, emits per-frame `scrollY`
/ `overscrollPx` / `dy` / render-mode over Serial. Off by default. Costs nothing
in release. This is how smoothness is verified on-device and the constants are
tuned from real numbers rather than feel.

## Files touched (summary)

**C++ runtime (emitted to `.ino`):**
- `packages/cuttlefish/src/ui/runtime-header.ts` — delete the removed state +
  cadence/cache machinery; add node fields, the layered engine, physics, render
  modes; keep the draw-time offset + dirty/clip primitives.

**JS preview (browser):**
- `packages/cuttlefish/src/preview/host-ui-runtime.ts` — mirror the new engine
  (input = capacitive/passthrough column).

**UI model / lowering / emit:**
- `packages/cuttlefish/src/ui/model.ts` — `virtualized` field; `scrollable`
  derivation unchanged.
- `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` — emit `virtualized`
  + the three list function pointers onto the node initializer; stop emitting a
  separate `UIListState` table.
- `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` — list-binding emit
  writes onto-node function pointers instead of a side table.
- `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` —
  `resolveBindListCall` records bindings onto the node.
- `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` — emit the new node
  fields; drop the `UIListState` table emission.

**Preview pipeline:**
- `packages/cuttlefish/src/preview/types.ts`, `build-program.ts` — list-binding
  spec already carries source expressions; keep, retarget to on-node state.

**Config:**
- `packages/cuttlefish/src/config-schema.ts` — add the optional `scroll:` block
  + validation/diagnostics.
- `demo-ui/cuttlefish.config.ts` — no change required (defaults derived from
  existing hardware declaration).

**Demo:**
- `demo-ui/src/hello.ui.html` — drop the redundant inline `overflow="scroll"`
  on `<list>` (it's a scroll container by default).

**No change:** `packages/ui/src/index.ts` (`ui.bindList` signature unchanged),
`packages/ui/src/types.ts`.

## Non-goals

- **Programmatic scroll / scroll events / `scrollTo`.** Separate future spec.
- **Horizontal scrolling.** Vertical only (matches today).
- **Multi-MCU capability matrix.** Two axes adapt; no per-board lookup table.
- **Fling / momentum / inertia.** Explicitly rejected (Q3).
- **New public API surface.** Strictly unchanged (Q6).
