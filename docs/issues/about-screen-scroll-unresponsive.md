# About screen scroll is unresponsive (preexisting)

**Status:** Open — separate from the scroll-engine rewrite (it predates that work).
**Date observed:** 2026-06-28

## Symptom

On the **About** screen of `demo-ui`, the `#aboutBody` scroll container is
completely unresponsive to drag and shows **no scrollbar**. The header back-link
works (so the screen renders), but dragging anywhere does nothing. Content below
the `object-fit 48x24 -> 60x40` heading (the three fit rows) is not reachable.

This was broken **before** the scroll-engine rewrite
(`docs/superpowers/specs/2026-06-28-scroll-engine-rewrite-design.md`) — it is not
a regression from that work. The Settings `<list>`, which uses the same unified
gesture/hit-scan path, scrolls correctly, so the gesture acquisition code is
sound.

## What the static (transpile-time) data says

Inspected `demo-ui/src/out/main/main.ino`. The About screen is `screenId=6`.

| node | element | box | scrollable | contentHeight | parent |
|---|---|---|---|---|---|
| 124 | `<screen id=about>` | 0,0,320,240 | 0 | 0 | 255 |
| 125 | `<body>` | 10,10,300,220 | 0 | 0 | 124 |
| 126 | header | 10,10,300,52 | 0 | 0 | 125 |
| 129 | `<main id=aboutBody>` | 10,62,300,168 | **1** | **292** | 125 |

`#aboutBody` is correctly marked `scrollable=1` (CSS `#aboutBody { overflow: scroll; }`),
and `contentHeight=292 > box.h=168`, so it overflows by ~124px and **should** be
scrollable. The deepest child (`#fitFillRow`, node 141) bottoms out at y≈354;
aboutBody starts at y=62, so true content height = 354−62 = 292 — `contentHeight`
is computed correctly.

## Why it's puzzling

The gesture hit-scan (`ui_touch_down`, runtime-header.ts) acquires a scroll owner
for any `scrollable` node where `contentHeight > box.h` and the touch falls in
its box. aboutBody satisfies all three. The hit-scan is the same path the
Settings list uses, and that works. So by every observable static signal, About
*should* scroll — yet it doesn't, and shows no scrollbar (the scrollbar draws
only when `contentHeight > box.h` at draw time).

## Where the bug likely lives (to investigate)

Since the static table says scrollable but the runtime behaves as if it isn't,
the most likely causes — all **runtime-only**, hence needing the device or a
working preview to confirm:

1. **`contentHeight` diverges at runtime.** Something overwrites aboutBody's
   `contentHeight` to ≤ `box.h` before the gesture/draw check. Candidates: a
   navigation reset, a binding evaluation, or the `ui_init`/per-frame list loops
   touching non-virtualized scrollable nodes. (A quick read suggests they only
   touch `virtualized` nodes, but verify.)
2. **An ancestor intercepts the gesture.** If `<body>` or another node were
   flagged scrollable at runtime (it isn't in the static table), it could shadow
   aboutBody. The static scan shows only aboutBody is scrollable on screen 6.
3. **`box.h` is recomputed larger at runtime** (e.g. a flex reflow giving
   aboutBody the full content height), making `contentHeight <= box.h`.

## Repro / next step

- Needs device or behavioral-preview testing (drive a drag on the About screen,
  assert `__ui_scroll_node` is set and `aboutBody.scrollY` changes).
- Enable `UI_SCROLL_DEBUG` and watch the Serial stream while dragging on About —
  if no `scroll dy=...` lines appear, the gesture isn't acquired (cause 1 or 2);
  if they appear but the screen doesn't move, it's a render issue.

## Out of scope of

The scroll-engine rewrite. Tracked here so the diagnosis isn't lost.
