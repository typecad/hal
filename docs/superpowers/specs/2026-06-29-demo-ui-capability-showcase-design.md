# demo-ui Capability Showcase — Design

**Date:** 2026-06-29
**Branch:** fix/preview-parity
**Scope:** Recreate the `demo-ui` example from scratch as a capability showcase that
exercises every supported HTML element and CSS property of the cuttlefish UI transpiler.

---

## 1. Goal

Recreate the `demo-ui` hardware-display demo (HTML + CSS → Arduino C++ via the cuttlefish
transpiler) as a **capability showcase**: a living style-guide where each screen isolates and
labels one capability family (Typography, Flexbox, Transforms, Forms, …). Success metric is
**coverage of the support matrix** — every supported element tag and CSS property appears at
least once — not visual polish.

User directive: *"don't keep the existing organization or format, start over and attempt to
use all supported css and html elements."*

## 2. Context (verified during exploration)

- Target: ILI9341 **320×240** landscape on ESP32 DevKit. Wiring unchanged from current config
  (`cs:5, dc:21, rst:22`, XPT2046 touch).
- Supported HTML tags (`html-parser.ts` + `ua-stylesheet.ts`):
  - Containers (remap to `view`/flexbox): `body div header footer nav main section article aside`
  - Text (remap to `text`): `span p h1 h2 h3 h4 h5 h6`
  - Native: `screen text button view check select option label radio progress range input
    keyboard row key style a img list canvas br`
- Supported CSS (`css-parser.ts`): box model (`padding margin width height min-/max- aspect-ratio
  box-sizing overflow`); color/background; font (`font-family -size -weight -style -smoothing
  -subset`); text (`text-align -decoration -transform -overflow`); `line-height letter-spacing
  white-space`; `transition`; `animation` + `@keyframes`; full flexbox (`display flex-direction
  gap row-gap column-gap flex flex-grow -shrink -basis align-self -items -content justify-content
  flex-wrap order`); `position z-index top right bottom left`; `border` (+ sides, `-width -color
  -style -radius`); `opacity visibility outline box-shadow text-shadow`; `transform
  transform-origin object-fit`; `@font-face`. Pseudo-classes: `:pressed :disabled :checked :focus`.
- Theme system (`theme-store.ts`, `ui-registry.ts:83-88`): config `display.themeCss` is an
  **absolute path** that **replaces** the sibling `.ui.css` entirely; `display.themeClass`
  (e.g. `'dark'`) selects the class-scoped token palette over `:root`. The theme file therefore
  must contain `@font-face` + tokens + `@keyframes` + all element rules in one file.
- TS API (`@typecad/ui`): `ui.mount`, `ui.signal`, `ui.bind`, `ui.bindList`, `ui.drawCanvas`;
  element handles expose `.value` / `.text` and `onClick / onHold / onRelease / onChange /
  onToggle`.

## 3. File layout

```
demo-ui/
  src/
    showcase.ui.html          NEW — entry HTML (10 screens)
    showcase.neobrutalism.css NEW — theme tokens + @font-face + @keyframes + all element rules
    showcase.ui.d.html.ts     GENERATED — per-id type declaration sibling
    main.ts                   REWRITTEN — imports from './showcase.ui.html'
    *.TTF, *.img              KEEP — font + image assets reused unchanged
    hello.*                   KEEP on disk (not deleted); just no longer referenced
  cuttlefish.config.ts        EDIT — entry stays './src/main.ts';
                               display.themeCss → '.../src/showcase.neobrutalism.css'
                               (themeClass:'dark' unchanged)
```

No destructive changes: old `hello.*` files remain on disk, unreferenced. Only the config's
`themeCss` path and the rewritten `main.ts` import change.

## 4. Screen taxonomy (10 screens)

A Home index screen (styled `<nav>` menu of `<a href="#screenId">` links) plus one screen per
capability family. Every content screen shares a header pattern: `<a class="backLink"
href="#home">‹ Back</a>` + `<h2 class="screenTitle">…</h2>` inside a `.screenHeader` container.
Multi-screen cross-navigation via `<a href>` is itself a showcased capability.

| # | id            | Family                 | Must exercise (elements / properties)                                                                                                                                                              |
|---|---------------|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0 | `home`        | Navigation index       | `<nav>`, `<a href>` cross-screen, `<header>/<footer>/<main>`, `<section>`, `<article>`, `<aside>`                                                                                                  |
| 1 | `typography`  | Text & fonts           | `h1`–`h6`, `p`, `span`, `font-family/size/weight/style`, `line-height`, `letter-spacing`, `text-align/decoration/transform`, `white-space` (nowrap/pre/pre-line), `text-shadow`, `@font-face`, `font-smoothing`, `font-subset` |
| 2 | `box`         | Box model & sizing     | `width/height/min-/max-`, `padding`, `margin`, `border` + sides/`-width/-color/-style`, `border-radius`, `box-sizing`, `aspect-ratio`, `box-shadow`, `outline`                                     |
| 3 | `layout`      | Position & layers      | `position` (relative/absolute), `top/right/bottom/left`, `z-index`, overlapping layers, `display:none` vs `hidden` attr, `visibility`                                                              |
| 4 | `flex`        | Flexbox                | `display:flex`, `flex-direction`, `justify-content`, `align-items/-content/-self`, `gap`/`row-gap`/`column-gap`, `flex/-grow/-shrink/-basis`, `flex-wrap`, `order`                                 |
| 5 | `transforms`  | Transform & animation  | `transform` (translate/scale/rotate), `transform-origin`, `@keyframes`, `animation` (+`-name/-duration/-iteration-count/-delay`), `transition`                                                     |
| 6 | `forms`       | Interactive forms      | `<button>`(+`:pressed`), `<check>`(+`onToggle`), `<select>`+`<option>`, `<radio>`(grouped via `name`)+`:checked`, `<progress>`, `<range>`(+`onChange`), `<input type=text/number>`(+`onChange`), `<label>`, `:disabled` |
| 7 | `media`       | Images & canvas        | `<img>` (incl. `object-fit` contain/cover/fill, `transform`), `<canvas>` via `ui.drawCanvas` (fillRect/rect/fillRoundRect/roundRect/line/hline/vline/fillCircle/circle/drawPixel/text/fillScreen)    |
| 8 | `lists`       | Virtualized list       | `<list item-height>` via `ui.bindList` (count + item text + tap callback)                                                                                                                           |
| 9 | `keyboard`    | On-screen keyboard     | `<keyboard variant>` + `<row>` + `<key>` (special: shift/backspace/ok/page-swap); classes `ui-key ui-key-ok ui-key-del ui-key-page ui-keyboard`                                                    |

This covers **all** supported tags and **all** supported CSS properties. Less-common tags
(`<article>`, `<aside>`, `<h4>`–`<h6>`) land on `home`/`typography` so nothing is left out.

## 5. Theme usage

Reuse the existing neobrutalism token set from `hello.neobrutalism.css`: `--background
--foreground --primary --primary-foreground --secondary --secondary-foreground --accent
--accent-foreground --muted --muted-foreground --card --card-foreground --destructive
--destructive-foreground --border --input --ring --chart-1..5 --radius --shadow`. Element rules
reference `var(--*)`; `themeClass:'dark'` selects the dark palette at build. The five existing
`@keyframes` (`pulse slideXY growMove originScale originScaleCenter quarterTurn`) are reused on
`transforms` — they already cover translate / scale / rotate / origin, so no new keyframes are
required. (If a `fade`/opacity animation is wanted on `layout`, add a single new `@keyframes
fade`; otherwise omit.)

## 6. main.ts wiring

Minimal per-element wiring, mirroring current `main.ts` conventions and staying inside the
SUPPORT_MATRIX (no new TS patterns):

- `ui.mount(screen, { display:'ili9341', bus:'SPI', cs:5, dc:21, rst:22 })`
- A counter signal → `ui.bind` on a text node's `color` + `text`; also bound to a conditional
  `visible` on the `layout` screen (even/odd branch toggle).
- `<button>` `onClick` increments counter; `:pressed` CSS handles the momentary visual.
- `<check>` `onToggle`, `<select>`/`<radio>` auto-wired (read `.value`).
- `<progress>` animated 0→100 via `setInterval`.
- `<range>` `onChange` logs `.value`; `<input>` `onChange` logs `.text`.
- `ui.bindList` populates the `lists` screen (count + item text + tap callback).
- `ui.drawCanvas` draws one composition on the `media` canvas exercising every primitive once.
- Custom `<keyboard>` wired to a text `<input>`.

## 7. Build & verify

1. `cuttlefish preview --config ./cuttlefish.config.ts` (from `demo-ui/`) — confirm the showcase
   transpiles and renders in the preview runtime.
2. `cuttlefish build --compile` (or `npm run compile`) — confirm the emitted C++ compiles for
   FQBN `esp32:esp32:esp32`.
Fix any transpile diagnostics before declaring done.

## 8. Non-goals

- Not changing transpiler / UI package source — pure demo authoring.
- Not deleting `hello.*` files (leave unreferenced).
- Not adding unsupported elements/properties (rejected by design).
- Not chasing visual polish over coverage — coverage is the success metric.
