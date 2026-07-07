# TFT SPI-write batching (deferred-refresh accumulator on immediate panels)

**Date:** 2026-07-06
**Goal:** Reduce tearing/flicker on per-frame updates on SPI TFT panels (ST7796S,
ILI9341, etc.) without the cost or scroll-incompatibility of the full-screen
framebuffer.

**Scope:** `packages/cuttlefish/src/ui/runtime-header.ts` (refresh scaffolding),
`packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (flag emission). No
changes to the dirty-node draw loop, the scroll-canvas subsystem, or the
framebuffer feature.

## Problem

On TFT, every per-node draw primitive (`fillRect`, text glyph, line, etc.) goes
through Adafruit's `SPITFT::writeFillRect` (and friends), each of which wraps
its pixel write in its own `startWrite()` / `endWrite()` pair — a separate
CS-asserted SPI burst. A frame with N dirty nodes therefore produces N+
separate SPI transactions against the panel, and the gaps between them read as
visible tearing or flicker, especially when several disjoint dirty rects push
during a single panel refresh cycle.

The experimental `UI_USE_FULL_FRAMEBUFFER` feature attempted to fix this by
rendering the whole frame into a PSRAM canvas and pushing it in one transaction,
but it is fundamentally incompatible with the scroll-canvas subsystem (Mode B):
the framebuffer's "repaint everything every frame" model collides with the
scroll canvas's dirty-gated shift-and-repair + conditional composite model.
Three patches each revealed a new coupling. That path needs an architectural
rethink and is out of scope here.

## The existing scaffolding (built for e-ink, currently no-op on TFT)

The runtime already has a complete deferred-refresh accumulator, gated on
`UI_REQUIRES_BACKING_STORE` (set for e-ink). At runtime-header.ts:375–417:

- `ui_refresh_begin_frame()` — resets the rect accumulator (called at frame
  start, runtime-header.ts:4046).
- `ui_refresh_add_rect(x,y,w,h)` — records a dirty paint rect (called per
  drawn node, runtime-header.ts:5088).
- `ui_refresh_flush()` — unions the rects and calls `display_partial_refresh`
  once (called at frame end, runtime-header.ts:5109).

When `UI_REQUIRES_BACKING_STORE` is **not** defined (TFT), all three compile to
`((void)0)` no-op macros (line 376–378), so call sites are byte-identical.

## Design

**Do not add a new subsystem. Activate the existing accumulator on TFT**, with
TFT-specific semantics: the flush issues **one batched SPI write window** for
the whole frame by wrapping the dirty-node draw pass in a single
`display_startWrite()` / `display_endWrite()` pair.

### Mechanism

Adafruit's `startWrite()` / `endWrite()` manage a transaction-depth counter on
`Adafruit_SPITFT`. When depth > 0, inner `fillRect` / `drawChar` / `writePixels`
calls reuse the already-open SPI transaction instead of opening and closing
their own. So all per-node draws within the frame share **one CS assertion**,
eliminating the inter-rect gaps that cause tearing. The cost is negligible:
one extra function-call pair per frame, no allocation, no extra pixel work.

This is gated on a new `UI_BATCH_SPI_WRITES` flag, emitted for immediate-refresh
TFT targets. It is independent of `UI_REQUIRES_BACKING_STORE`.

### Branch structure (runtime-header.ts:375–417)

Replace the current `#ifndef UI_REQUIRES_BACKING_STORE` / no-op / `#else` /
e-ink block with a three-branch dispatch:

```c
#if defined(UI_REQUIRES_BACKING_STORE)
  // e-ink: existing partial-refresh accumulator (unchanged).
  ... existing code ...
#elif defined(UI_BATCH_SPI_WRITES)
  // TFT immediate-refresh: wrap the frame in one SPI transaction.
  static inline void ui_refresh_begin_frame() { display_startWrite(); }
  static inline void ui_refresh_add_rect(int16_t x, int16_t y, int16_t w, int16_t h) { (void)x; (void)y; (void)w; (void)h; }
  static inline void ui_refresh_flush() { display_endWrite(); }
#else
  // No batching (e.g. SDL native host render): true no-ops.
  #define ui_refresh_begin_frame()  ((void)0)
  #define ui_refresh_add_rect(x, y, w, h) ((void)0)
  #define ui_refresh_flush()        ((void)0)
#endif
```

Notes:
- `ui_refresh_add_rect` is a no-op in the TFT branch — the batching is purely
  about the `startWrite`/`endWrite` window, not about coalescing rects (TFT has
  no partial-refresh concept; the per-node draws already target the right
  pixels). The accumulator is only meaningful for e-ink's partial refresh.
- `display_startWrite` / `display_endWrite` are emitted by every display
  adapter (e.g. st7796.ts:70–71) and already used by the framebuffer/canvas
  push paths. They are available wherever the runtime header is included.
- `UI_BATCH_SPI_WRITES` and `UI_REQUIRES_BACKING_STORE` are mutually exclusive
  by construction: the emitter sets `UI_REQUIRES_BACKING_STORE` only when
  `caps.requiresBackingStore` is true, and sets `UI_BATCH_SPI_WRITES` only when
  `refreshModel === "immediate" && !requiresBackingStore`. So the `#elif` order
  (backing-store first, then batch, then default) is safe and exactly one
  branch ever compiles.

### Flag emission (ui-emitter.ts:272–280)

The emitter currently emits `#define UI_REFRESH_DEFERRED 1` when
`caps.refreshModel !== "immediate"`, and `#define UI_REQUIRES_BACKING_STORE 1`
when `caps.requiresBackingStore`. Add:

```ts
if (caps.refreshModel === "immediate" && !caps.requiresBackingStore) {
  ctx.sourceLines.push("#define UI_BATCH_SPI_WRITES 1");
}
```

This enables batching for TFT (immediate, no backing store) while leaving e-ink
(deferred-partial + backing store) and SDL native (immediate but no
`display_startWrite`/`endWrite` shim in the same shape) on their existing
paths. The third `#else` branch in the runtime header covers any target that
defines neither flag.

## Why this composes with scroll

The scroll-canvas subsystem draws into its own offscreen canvas and composites
via `ui_push_buffered_scroll_canvas` (runtime-header.ts:1472), which calls
`display_startWrite` / `setAddrWindow` / `writePixels` / `display_endWrite`
internally. With the frame wrapped in `startWrite`/`endWrite`, that composite
becomes a **nested** transaction: Adafruit's `startWrite` increments a depth
counter (1 → 2) and `endWrite` decrements (2 → 1), so the inner pair is a no-op
for transaction lifecycle and the actual SPI close happens once at frame end.
The scroll composite's pixels land in the same single SPI burst as the direct
per-node draws.

No change to scroll logic, no change to the dirty model, no framebuffer. The
dirty-gated scroll-canvas composite fires exactly as it does today; only the
SPI transaction boundary moves from per-draw to per-frame.

## What is NOT changing

- **The dirty-node draw loop** — unchanged. The mark-all-dirty block added
  during the framebuffer investigation is reverted (it was framebuffer-only;
  batching uses the existing dirty model verbatim).
- **The scroll-canvas subsystem** — unchanged. Nested `startWrite` handles the
  composite.
- **The framebuffer feature** — left as-is (still opt-in via
  `UI_USE_FULL_FRAMEBUFFER`, still incompatible with scroll; out of scope).
- **The e-ink partial-refresh path** — unchanged (still gated on
  `UI_REQUIRES_BACKING_STORE`).

## Files

| File | Change |
|---|---|
| `packages/cuttlefish/src/ui/runtime-header.ts` | Replace the two-branch refresh dispatch (line 375–417) with a three-branch dispatch adding the `UI_BATCH_SPI_WRITES` path. Revert the framebuffer mark-all-dirty block (line ~4206) added during investigation. |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Emit `#define UI_BATCH_SPI_WRITES 1` for immediate-refresh, non-backing-store targets. |
| `demo-st/cuttlefish.config.ts` | Already reverted to `UI_USE_FULL_FRAMEBUFFER: '0'` — no further change. |

## Verification

- **TDD:** a runtime-header test asserting (a) the `UI_BATCH_SPI_WRITES` branch
  emits `display_startWrite()` in `begin_frame` and `display_endWrite()` in
  `flush`, (b) the `UI_REQUIRES_BACKING_STORE` branch is unchanged, (c) the
  default `#else` no-op stubs are unchanged.
- **Unit:** existing runtime-header tests (119) stay green; the batch-branch is
  additive and the existing branches are byte-identical.
- **Hardware (you flash):** demo-st scroll showcase on S3+PSRAM. Confirm:
  (a) scrolling still smooth (no regression — the dirty/scroll model is
  untouched), (b) reduced tearing on binding/press updates, (c) no flashing
  (the framebuffer's per-frame full repaint is gone).

## Out of scope (explicit)

- Designing the proper framebuffer + scroll composition (Approach B from the
  brainstorm). Tracked as a separate future effort if atomic full-frame
  rendering becomes a requirement.
- Coalescing/merging the e-ink dirty rects (the `TODO Phase 5` at
  runtime-header.ts:394). That's an e-ink optimization, unrelated to TFT
  batching.
