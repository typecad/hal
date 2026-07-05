# Cuttlefish UI authoring deviations & conventions

**Date:** 2026-07-05
**Status:** Reference. Documents the CSS/HTML behaviors that deviated from web
expectations, the fixes applied, and the authoring conventions that avoid
remaining sharp edges.

## Deviations (now fixed)

### Bold no longer inflates the GFX text-size bucket
**Was:** `model.ts:textSizeOf` and `layout-engine.ts:gfxTextSizeOf` quantized
`font-size` into 4 buckets and added 1 for `font-weight: bold`, so `<h3>`
labels rendered larger than their declared `font-size`.
**Fixed:** Removed the bump from both copies of the function. Bold now only
affects glyph stroke weight (via `@font-face`), matching the web. Note: there
were *two* mirror copies of the logic — the layout engine uses `gfxTextSizeOf`,
so fixing only `model.ts:textSizeOf` had no effect on layout; both had to change.

### Interpolation text measures without literal braces
**Was:** `measure()` used `node.text` directly, so `taps: {count}` reserved
the full literal-brace width at layout time.
**Fixed:** `measure()` now strips `{}` (gated on `node.hasInterpolation`) before
measuring, so `taps: {count}` measures like `taps: count`.

### UA min-height removed from form controls
**Was:** `ua-stylesheet.ts` forced `min-height: 20px` on `input`/`select`/`range`
and `12px` on `progress`, overriding explicit `height:Npx`.
**Fixed:** Removed the declarations; controls size per their CSS, matching the
web's content-sized default.

### Flex-row children already shrink (investigation, no fix needed)
**Was suspected:** Wide children with intrinsic text width pushed past the flex
container because `flex-shrink` wasn't applied.
**Found:** Yoga already applies default `flex-shrink: 1`, so children compress.
The demo's actual overflow was caused by interpolation text reserving
literal-brace width (fixed above) plus `white-space: nowrap` pinning min-content
to that width — not by missing shrink. A regression test guards the shrink
behavior; no engine change was required.

### `themeCss` warns when ignored on a `.ui` entry
**Was:** `themeCss` was silently ignored for `.ui` single-file entries (only the
inline `<style>` loads).
**Fixed:** Emits a `themeCss-ui-entry-ignored` warning so authors don't maintain
a dead standalone stylesheet.

## New transpile-time diagnostics

- **`layout-viewport-overflow`** — a laid-out node's box bottom exceeds the
  mount viewport. Cause: a flex column taller than the screen. Fix: reduce
  content height, tighten padding/gap, or add `overflow: scroll`.
- **`layout-text-overflow`** — a text/button node's right edge extends past its
  parent's content right edge. Cause: text too wide for the container (often a
  sibling-sum overflow). Fix: shorten the text, `white-space: nowrap`, or widen
  the parent.
- **`themeCss-ui-entry-ignored`** — `display.themeCss` is set but the entry is a
  `.ui` single-file component. Fix: move the CSS into the `.ui`'s inline
  `<style>`, or switch the entry to a `.ts` file that imports a `.ui.html`.

## Authoring conventions (still recommended)

1. **Single-token interpolation.** Prefer `{count}` over `taps: {count}`. Even
   with the brace-stripping fix, a single token is the most predictable form.
   If descriptive context is needed, put it in a sibling non-interpolated
   element.
2. **`font-weight: normal` on labels.** Even with the bold-bump fix removed,
   explicit `normal` on shared label classes (`.demoLabel`) documents intent and
   guards against future regressions.
3. **Measure before flashing.** Run `npm run measure --workspace demo-st` (or
   the equivalent `lowerOnMount` test) to verify layout fits before hardware.
   The `layout-viewport-overflow` diagnostic now catches the most common
   overflow at transpile time, but the measurement tool gives full box detail.

## Reusable tooling

- `demo-st/scripts/measure-layout.mjs` — prints laid-out boxes + overflow
  summary for `showcase.ui` against the configured 480×320 viewport. Run via
  `npm run measure --workspace demo-st`. Requires a built cuttlefish dist.

## Implementation

Implemented in `docs/superpowers/plans/2026-07-05-authoring-surprises.md`
(11 tasks, TDD). Key commits:
- viewport-overflow + text-overflow diagnostics (`ui-registry.ts:lowerOnMount`)
- `themeCss` warning (`transpile.ts`)
- bold-bump removal (`model.ts` + `layout-engine.ts`)
- interpolation brace-stripping (`layout-engine.ts:measure`)
- UA min-height removal (`ua-stylesheet.ts`)
- flex-shrink regression test (`block-layout.test.ts`)
- measurement tool (`demo-st/scripts/measure-layout.mjs`)
