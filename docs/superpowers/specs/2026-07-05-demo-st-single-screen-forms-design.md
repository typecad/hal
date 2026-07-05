# demo-st → single-screen forms demo

**Date:** 2026-07-05
**Scope:** `demo-st/` only. No runtime, header, or emitter changes in
`packages/cuttlefish/src`.

## Goal

Replace `demo-st`'s 10-pane master-detail `showcase.ui` with **one
non-scrolling 320×480 screen that demos every cuttlefish form control**.
Everything that is not a form element is removed. The NeoBrutalism dark theme,
the ST7796S + FT6336U display/touch configuration, and the existing reactive
wiring patterns (`ui.signal` / `ui.bind` / `onChange`) are preserved.

This is a focused rewrite of demo output, not a change to transpiler behavior.

## Form inventory (kept)

| Control | Reactive effect |
|---|---|
| `button` + counter signal | `taps: {count}` |
| `check` + lamp | `featureStatus` text + `featureLamp` background |
| `select` | `modeStatus` text + `modeAccent` background |
| `radio` group | `radioStatus` text |
| `range` | `volumeStatus` text + `formProg` value + `formProgressCaption` |
| `input[type=text]` | `nameCommits` counter, logs on change |
| `input[type=number]` | `ageCommits` counter, logs on change |
| `button[disabled]` | static `:disabled` demo |

All current bindings in the inline `<script>` of `showcase.ui` are reused.

## Removed

- Master-detail shell: `#homeNav`, the `section` signal, all `showXxx()`
  handlers, every `ui.bind(..., 'visible', ...)` pane toggle, `.scrollBody`,
  `.detailPane`, the per-pane `width: 192px` / `height: 212px` scroll-viewport
  rules. With a single non-scrolling screen there is no Mode B canvas, no
  scroll owner, and no detail-pane swap.
- Non-form panes: typography, rich text, box & sizing, position & layers,
  flexbox, transforms & animation, images & canvas, lists, the dedicated
  keyboard pane.
- `ui.bindList` (lists) and `ui.drawCanvas` (media) wiring.
- Inline `<style>` rules for the removed panes: typography / box / position /
  flex / transform / media / list / keyboard-screen rules, plus `@keyframes`
  and animation/transition rules. Only the rules the new screen references
  survive (see "CSS authority" below).
- Dead code confirmed during planning:
  - `demo-st/src/main.ts` — imports the stale split `showcase.ui.html` and is
    imported by nothing. The active entry is `./src/showcase.ui`, a
    single-file component whose inline `<script>` already performs all wiring.
  - `demo-st/src/showcase.ui.html` — the pre-single-file split version. Only
    imported by the dead `main.ts`. The single-file `showcase.ui` supersedes
    it.
  - `demo-st/src/showcase.neobrutalism.css` — **dead**. Its header comment
    claims it is the theme source, but for a `.ui` single-file entry the
    transpiler never reads it: `graph-builder.ts` and
    `preview/build-program.ts` both pass `parts.style` (the inline `<style>`)
    as the only CSS text, and the `themeCss` config key is consulted only on
    the `.ui.html` disk-read path. Its palette no longer matches the live
    inline styles. Delete to avoid future confusion.

## Preserved

- `demo-st/cuttlefish.config.ts` unchanged (entry, display profile, touch
  calibration). Its `themeCss` / `themeClass` keys are no-ops for a `.ui`
  entry but harmless and left as-is to minimize churn.
- The `<keyboard id="kbAlpha" variant="alpha">` template (sibling of
  `<screen>` inside `showcase.ui`). Text and number inputs open the system
  keyboard; without the keyboard template the inputs are unusable on this
  hardware. The dedicated keyboard *pane* is removed but the keyboard
  *template* stays.
- `@font-face` declarations and the `:root` / `.dark` palette blocks — these
  live in the **inline `<style>`** of `showcase.ui` (the sole CSS authority;
  see below), and are carried into the rewritten file verbatim.
- Out-of-scope sibling files: `hello.*`, `nav.*`, `counter.ui`, `*.img`.
  Pre-existing, unrelated, untouched.

## CSS authority (clarification added during planning)

For a `.ui` single-file entry, the **inline `<style>` block is the only CSS
source** for both runtime and preview. Verified in
`packages/cuttlefish/src/orchestrator/graph-builder.ts` (line ~129:
`loadUIModuleFromText(uiHtmlPath, parts.html, parts.style, filePath)`) and
`packages/cuttlefish/src/preview/build-program.ts` (line ~600:
`cssText = parts.style`). The `display.themeCss` config key is consulted only
on the `.ui.html` disk-read path (`ui-registry.ts` `loadUIModule`), never for
a single-file `.ui`. Therefore the rewrite edits only the inline `<style>`
inside `showcase.ui`; the standalone `showcase.neobrutalism.css` is deleted as
dead code, not trimmed.

## Layout — two-column flex grid

Selected layout: two-column grid (per the decision in the brainstorm).

The screen body is a flex column of rows. Each row is a flex row holding one or
two cards; a full-width card is the sole child of its row. This matches the
existing codebase idiom (`display: flex; flex-direction: row`) — no dependency
on CSS grid support.

```
┌──────────────────────────────────────────┐
│           cuttlefish · forms             │  header (full width)
├───────────────────────────┬──────────────┤
│  [ tap me ]    taps: 3    │  ☑ Enable  ● │  button | checkbox
├───────────────────────────┼──────────────┤
│  Mode [ Alpha ▾ ]    ●    │ (●)Calm( )Fast│  select | radio
│  mode: alpha              │  speed: calm  │
├───────────────────────────┴──────────────┤
│  Volume  ████░░░░░░░░  3                 │  range + progress (full width)
│  meter   ▓▓▓░░░░░░░  30%                  │
├────────────────────────────┬─────────────┤
│  Name                      │  Age         │  text | number
│  [ Adafruit______ ]        │  [ __ ]      │
├────────────────────────────┴─────────────┤
│  [ cannot tap ]   │  tap a field to type │  :disabled | hint
└──────────────────────────────────────────┘
```

### Vertical budget (320 × 480 portrait)

Compact cards, 6 px gaps, 10 px screen padding:

| Row | Height |
|---|---|
| header | ~44 |
| button \| checkbox | ~56 |
| select \| radio | ~72 (card + status line) |
| range + progress | ~96 |
| text \| number | ~72 |
| `:disabled` \| hint | ~48 |
| gaps (5 × 6) + padding (2 × 10) | ~50 |
| **Total** | **≈ 438 px** |

Comfortably inside 480 — no scroll container required.

### Element IDs (carried over where the wiring already references them)

`formBtn`, `formBtnCount`, `formCheck1`, `featureLamp`, `featureStatus`,
`formSelect1`, `modeAccent`, `modeStatus`, `formRadio1`, `formRadio2`,
`radioStatus`, `formRange1`, `volumeStatus`, `formProg`,
`formProgressCaption`, `formName`, `formAge`, `formDisabledBtn`. New wrapper
IDs (`formHeader`, `formRow1`…`formRowN`, `formHint`) are introduced as needed
for the grid rows.

## Files

| File | Action |
|---|---|
| `demo-st/src/showcase.ui` | **Rewrite.** New inline `<script>` (form wiring only), trimmed inline `<style>`, new single-screen template; keep `<keyboard>`. This is the sole CSS authority (see "CSS authority"). |
| `demo-st/src/showcase.neobrutalism.css` | **Delete** (dead — not loaded for a `.ui` entry; palette stale). |
| `demo-st/src/main.ts` | **Delete** (dead — orphaned by the single-file entry). |
| `demo-st/src/showcase.ui.html` | **Delete** (dead — only imported by the dead `main.ts`). |
| `demo-st/cuttlefish.config.ts` | Unchanged. `themeCss`/`themeClass` are no-ops for `.ui` but left as-is. |
| `demo-st/src/hello.*`, `nav.*`, `counter.ui`, `*.img` | Untouched (out of scope). |

Per `AGENTS.md`: change the source (`showcase.ui` / `.css`), then regenerate
`demo-st/src/out/` via the compile step. Never hand-edit `main.ino`.

## Verification

Per the AGENTS.md "Verification" section, adapted for `demo-st` (which is not
a root-workspace entry, so its scripts run from the `demo-st` directory):

1. `npm run build --workspace @typecad/cuttlefish` — keep `dist` fresh so the
   compile does not exercise stale transpiler output.
2. `npm run compile` (from `demo-st/`) — transpile + `arduino-cli` compile of
   the rewritten screen; regenerates `demo-st/src/out/`.
3. Eyeball the regenerated `main.ino` for the expected form-element wiring
   (button handler, bindings, keyboard open) and absence of nav/scroll/list
   artifacts.

No runtime-header or preview test changes: this is demo output, not runtime
code. The existing focused tests in
`tests/packages/cuttlefish/runtime-header.test.ts` are unaffected and still run
as part of the normal cuttlefish build verification, but no new tests are
required for a demo rewrite.
