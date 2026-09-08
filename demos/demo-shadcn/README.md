# demo-shadcn

The **canonical UI demonstration** for the TypeCAD UI package — everything
the engine can do, themed end-to-end by the shadcn component kit. Runs on an
ESP32-S3 + ST7796S panel (same board and wiring as `zephyr-ui`) and in the
browser preview at the panel's true 480×320 rgb565 — colors, scroll physics,
and the AA font all render exactly what the hardware shows.

## Screen map (19 screens)

| Screen | What it demonstrates |
|--------|----------------------|
| Button | all button variants + sizes, `on:click` callbacks, live `{signal}` badge |
| Badge & Separator | badge variants, `hr` separators |
| Card | full card anatomy (header / title / description / content / footer) |
| Form Controls | input + keyboard-less echo, switch (sliding pill knob), select (modal option list), checkbox, radio group, range, validation states (destructive border + hint) |
| Alert & Skeleton | default/destructive alerts, pulsing skeleton (opacity keyframes) |
| Progress & Avatar | Thread-driven progress, `img` avatar |
| Table | UA equal-width table approximation |
| Typography | `h1`–`h6`, `p`, `small`, `pre`/`code`/`kbd` (bundled mono face), `ul`/`ol`/`li`, `dl`/`dt`/`dd`, `text-transform`, `letter-spacing`, ellipsis |
| Rich Text | inline runs (`b`/`i`/`u`/`span` color+size), hard breaks, nested styles, tappable rich links |
| Layers & Visibility | absolute positioning, `z-index` stacking, `hidden` attr, `display: none`, `visibility: collapse` |
| Gradients & Motion | `linear-gradient`, hard/soft/inset shadows, transform keyframes (slide/rotate/scale) + background keyframes |
| Images & Canvas | `img` `object-fit` contain/cover/fill, `ui.drawCanvas` with every primitive |
| Virtualized List | `ui.bindList` (40 rows), item taps driving a signal, scroll + settle physics |
| Keyboard | on-screen custom keyboard (`<keyboard>` template) bound to an input |
| State & Bindings | signals + `{expr}` interpolation, `ui.bind` text/style bindings, declarative `bind:value` two-way (range ↔ signal), `ui.window.setTitle`, interval clock, `meter`, disabled controls |
| Drawer | slide-in panel (`<drawer side>`, author-styled absolute panel), `ui.drawer.open/close`, outside-tap dismiss, themed content |
| Dialog & Toast | centered modal (`<dialog>`, scrim tap closes, footer buttons), auto-dismissing `<toast>` with a live counter |
| Tabs | segmented trigger row + absolutely-stacked panes switched by a signal (`ui.bind(x, 'visible', ...)`), active-trigger styling, live pane content |
| Accordion | single-open collapsible sections (signal + `visible` bindings), chevron `v`/`^` text swap, live section content |

## Running it

```sh
npm run build                 # transpile (passes --autosar=strict)
npm run preview               # browser preview, device-faithful 480x320 rgb565
npm run compile               # typecad-hal build --compile (west toolchain)
```

## Theming

- `src/styles/shadcn.css` is this project's **copy** of the kit preset
  (copy-and-own, like shadcn/ui itself).
- `app.ui`'s `<style>` does `@import "./styles/shadcn.css"` and adds the
  demo's screen chrome, expressed only through the kit's tokens.
- `themeClass: 'dark'` in `typecad-hal.config.ts` selects the dark token set;
  flip to `'light'` (or remove it) and **refresh the preview** — the server
  re-reads the config on every snapshot build.
- Paste any stock shadcn/tweakcn theme into the `:root`/`.dark` blocks —
  both HSL-triplet and `oklch()` dialects resolve at build time.

## Authoring notes learned the hard way (all enforced by this demo)

- Interactive elements **and `<img>` tags** carry an **id**: the preview
  wires `on:*`, `bind:*`, `{expr}` interpolations, and image asset loading
  by id, and warns when one is missing.
- Non-void elements (`<check>`, `<input>`, `<select>`, `<meter>`, ...) are
  explicitly closed — self-closed tags nest their following siblings.
- Runtime-dynamic text (`ui.bind(x, 'text', ...)`, `{expr}`, `bind:text`)
  gets the fallback charset automatically, so bound strings always have
  glyphs.
- `ui.drawCanvas` bodies lower best as flat `ctx` call sequences.
- Screens scroll; controls below the fold need scrolling into view before
  tapping (the scroll viewport clips hit-testing — by design).
