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
- Dead code: `demo-st/src/main.ts`. It imports the stale split
  `showcase.ui.html` and is imported by nothing — the active entry is
  `./src/showcase.ui`, a single-file component whose inline `<script>` already
  performs all wiring.
- CSS rules for the removed panes in `showcase.neobrutalism.css`:
  typography/box/position/flex/transform/media/list/keyboard-screen rules,
  plus `@keyframes` and animation/transition rules. Only the rules the new
  screen references survive.

## Preserved

- `demo-st/cuttlefish.config.ts` unchanged (entry, themeCss, themeClass,
  display profile, touch calibration).
- The `<keyboard id="kbAlpha" variant="alpha">` template. Text and number
  inputs open the system keyboard; without the keyboard template the inputs
  are unusable on this hardware. The dedicated keyboard *pane* is removed but
  the keyboard *template* (a sibling of `<screen>`) stays.
- `@font-face` declarations and the `:root` / `.dark` palette blocks in
  `showcase.neobrutalism.css`.
- Out-of-scope sibling files: `showcase.ui.html`, `hello.*`, `nav.*`,
  `counter.ui`, `*.img`. Pre-existing, unrelated, untouched.

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
| `demo-st/src/showcase.ui` | **Rewrite.** New inline `<script>` (form wiring only), trimmed `<style>`, new single-screen template; keep `<keyboard>`. |
| `demo-st/src/showcase.neobrutalism.css` | **Trim.** Keep `@font-face`, palette, screen/card/form rules; drop type/box/position/flex/transform/media/list/keyboard-screen rules and `@keyframes`. |
| `demo-st/src/main.ts` | **Delete** (dead — orphaned by the single-file entry). |
| `demo-st/cuttlefish.config.ts` | Unchanged. |
| `demo-st/src/showcase.ui.html`, `hello.*`, `nav.*`, `counter.ui`, `*.img` | Untouched. |

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
