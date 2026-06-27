# @typecad/ui — HTML/CSS-Driven Graphics for Microcontrollers

Write UIs in HTML and CSS. TypeHAL lowers them to a retained-mode C++ runtime that draws on ILI9341 (and future) displays over hardware SPI. No browser, no DOM, no CSS engine on the device — everything is resolved at transpile time.

## Quick start

### 1. Create your UI files

**`app.ui.html`** — the screen layout:

```html
<screen>
  <text id="title">My Device</text>
  <button id="action">Start</button>
</screen>
```

**`app.ui.css`** — styling with real CSS (flexbox, named colors, borders):

```css
screen {
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

#title {
  color: dodgerblue;
  font-size: 16px;
}

#action {
  background: darkgreen;
  color: white;
  border: 2px solid limegreen;
  border-radius: 4px;
  padding: 8px 20px;
  text-align: center;
  transition: background 300ms;
}

#action:pressed {
  background: limegreen;
}
```

**`main.ts`** — mount and wire interactions:

```typescript
import { ui } from '@typecad/ui';
import { screen } from './app.ui.html';

ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5, dc: 21, rst: 22,
});
```

### 2. Build

```bash
npx typehal src/main.ts --compile
```

## Elements

### `<screen>`

The root container. Required (exactly one). Its box fills the display viewport (320×240 landscape for ILI9341).

### `<view>`

A generic container. Supports `display: flex` for layout. Has a `.value` property and `onToggle`/`onChange` for interaction.

```html
<view id="row">
  <text id="label">Status</text>
  <text id="value">OK</text>
</view>
```

### `<text>`

Static or dynamic text. Has a `.value` property for numeric state.

```html
<text id="counter">0</text>
```

### `<button>`

A clickable button with `:pressed` pseudo-state support and transition animations.

```html
<button id="start">Start</button>
```

### Interactive elements

| Element | Purpose | `.value` |
|---|---|---|
| `<check>` | Checkbox (tap to toggle) | 0 / 1 |
| `<radio name="g">` | Radio (mutually exclusive within a `name` group) | 0 / 1 |
| `<select>` | Tap to cycle options; text auto-shows the current option | 0..N-1 |
| `<progress>` | Progress bar (0-100) | fill percentage |
| `<range>` | Draggable slider | between `min` and `max` |
| `<input>` | Text input (tap opens the on-screen keyboard) | — (use `.text`) |
| `<list>` | Virtualized, data-bound list (renders only visible items) | — |

```html
<range id="brightness" min="0" max="100"></range>
<progress id="load" value="40"></progress>
<check id="enable">Enable feature</check>
<input id="ssid" type="text" placeholder="Network name" maxlength="32"></input>
<select id="mode"><option>Auto</option><option>Manual</option></select>
```

Slider and progress values can be driven live from `loop()` via bindings (see
[Reactive bindings](#reactive-bindings) below).

### Images

`<img>` embeds a raw RGB565 `.img` file as a `static const uint16_t[]` array:

```html
<img id="logo" src="assets/logo.img" width="64" height="64"></img>
```

The `.img` file is a flat row-major RGB565 dump (width × height × 2 bytes). Use
`object-fit` (`contain`, `cover`, `fill`) to control scaling.

### HTML tag aliases

Common HTML tags are accepted and remapped to the internal primitives, so you
can write familiar HTML:

| HTML tag | Maps to | Notes |
|---|---|---|
| `body`, `div`, `header`, `footer`, `nav`, `main`, `section`, `article`, `aside` | `<view>` | Block container |
| `span`, `p`, `h1`–`h6` | `<text>` | Inline/heading text |

```html
<header><h1 id="title">Settings</h1></header>
<main><p id="desc">Adjust preferences.</p></main>
```

### Global attributes

All UI elements support the `hidden` attribute. Hidden elements and their
descendants stay in the generated node table, but they do not take space in
layout and are skipped for drawing and hit testing.

```html
<view id="advancedPanel" hidden>
  <text>Advanced settings</text>
</view>
```

## CSS reference

### Supported properties

#### Box model
| Property | Values | Notes |
|---|---|---|
| `padding` | `8px`, `8px 16px` | Shorthand supported |
| `margin` | `8px`, `8px 16px` | Shorthand supported |
| `width` | `100px` | Explicit size |
| `height` | `50px` | Explicit size |
| `min-width` / `max-width` | `100px` | Yoga constraints |
| `min-height` / `max-height` | `50px` | Yoga constraints |
| `aspect-ratio` | `16 / 9`, `1 / 1`, `1.5` | Infers the missing width or height |
| `box-sizing` | `border-box` | Yoga border-box |
| `overflow` | `hidden`, `scroll` | Clips children; `scroll` enables touch-drag scrolling |

#### Length units

All length values accept `px`, bare numbers, and `rem`/`em` (× 16 root font
size). `0.625rem` resolves to `10px`. Percentages are used as-is in the contexts
that honor them (flex/position).

`calc()` evaluates simple arithmetic (`+ - * /`) on lengths after `var()`
substitution, with proper operator precedence:

```css
:root { --radius: 10px; }
.card { border-radius: calc(var(--radius) - 4px); }   /* 6px */
.a { padding: calc(0.625rem * 2); }                   /* 20px */
```

#### Flexbox (via Yoga)
| Property | Values |
|---|---|
| `display` | `flex`, `none` |
| `flex-direction` | `row`, `row-reverse`, `column`, `column-reverse` |
| `gap` | `8px` (sets both row and column gap) |
| `row-gap` / `column-gap` | `8px` (per-axis; overrides uniform `gap`) |
| `flex-grow` | `1` |
| `flex-shrink` | `0` |
| `flex` (shorthand) | `1`, `1 0 auto`, `none` |
| `align-items` | `flex-start`, `center`, `flex-end`, `stretch` |
| `align-self` | `flex-start`, `center`, `flex-end`, `stretch`, `baseline` |
| `align-content` | `flex-start`, `center`, `flex-end`, `stretch`, `space-between`, `space-around`, `space-evenly` |
| `justify-content` | `flex-start`, `center`, `flex-end`, `space-between`, `space-around`, `space-evenly` |
| `flex-wrap` | `wrap`, `nowrap`, `wrap-reverse` |
  | `order` | `1`, `2`, ... |
  | `position` | `relative`, `absolute`, `static` |
  | `top` / `right` / `bottom` / `left` | `10px` |
  | `z-index` | numeric layers; inherited by descendants |

`display: none` removes the element subtree from layout, drawing, and hit
testing while preserving generated node indices.

#### Colors
All standard CSS color formats are supported:
- `#rrggbb` — `#ff0000`
- `#rgb` — `#f00`
- `#rrggbbaa` — `#ff0000ff` (alpha ignored)
- `rgb(r,g,b)` — `rgb(255, 0, 0)`
- `rgba(r,g,b,a)` — `rgba(255, 0, 0, 0.5)` (alpha ignored)
- `hsl(h, s%, l%)` / `hsla(...)` — `hsl(240, 100%, 50%)`, `hsla(0 0% 0% / 0.05)`
- Named colors — `red`, `dodgerblue`, `limegreen`, `transparent`, ... (147 CSS named colors)

Both comma (`hsl(0, 0%, 0%)`) and CSS4 space (`hsl(0 0% 0%)`) syntaxes work.
The slash-alpha form (`hsl(0 0% 0% / 0.05)`) is honored in `box-shadow` alpha;
elsewhere alpha is ignored (no runtime blending on bare metal).

#### Typography
| Property | Values | Notes |
|---|---|---|
| `color` | any color | Text foreground color |
| `font-family` | `"MyFont"` | Uses a generated font when matched by `@font-face`; otherwise the built-in bitmap font |
| `font-size` | `16px` | Generated fonts are rasterized at this pixel size; bitmap text maps to GFX text size |
| `font` | `italic bold 18px DeviceSans` | Shorthand support for style, weight, size, and family |
| `text-align` | `left`, `center`, `right` | Horizontal alignment within the box |
| `text-decoration` | `underline`, `line-through`, `none` | Both may combine: `underline line-through` |
| `text-overflow` | `ellipsis`, `clip` | Truncates overflowing single-line text with `...` |
| `text-transform` | `uppercase`, `lowercase`, `capitalize`, `none` | Applied at transpile time |
| `line-height` | `1.5`, `150%`, `24px` | Line advance for wrapped text; `normal` = font default |
| `letter-spacing` | `2px`, `-1px` | Per-character advance adjustment |
| `white-space` | `normal`, `nowrap`, `pre`, `pre-line` | Controls word-wrap behavior |
| `font-weight` | `normal`, `bold`, `400`, `700` | Selects the matching `@font-face` variant when available |
| `font-style` | `normal`, `italic`, `oblique` | Selects the matching `@font-face` variant when available |
| `font-smoothing` | `antialiased`, `none` | Overrides display-level text antialiasing |
| `font-subset` | `exact`, `fallback` | Controls generated-font glyph selection |

### Fonts

Local TTF/OTF fonts can be referenced with `@font-face`. The transpiler does
not copy the whole font to the board. It reads the font at build time, rasterizes
only the glyphs needed by the UI, packs them as 4-bit alpha bitmap data, and
emits those tables into the firmware. On ESP32-class targets those generated
tables are `static const` data in flash/rodata; the original TTF/OTF file is not
held in RAM on the hardware.

#### Install a font in a project

Put font files somewhere inside the project, usually next to the `.ui.css` file
or under a local `fonts/` folder:

```text
src/
  app.ui.html
  app.ui.css
  fonts/
    DeviceSans-Regular.ttf
    DeviceSans-Bold.ttf
```

Reference them from CSS with paths relative to the `.ui.css` file:

```css
@font-face {
  font-family: "DeviceSans";
  src: url("fonts/DeviceSans.ttf");
}

#title {
  font-family: "DeviceSans";
  font-size: 24px;
  font-smoothing: antialiased;
}
```

Remote font URLs are not supported for embedded builds. Use local files so the
build is reproducible and does not depend on network access.

#### Declare variants

Declare each weight/style variant as its own `@font-face`. The UI compiler
chooses the closest matching variant for each node based on `font-family`,
`font-weight`, `font-style`, and `font-size`.

```css
@font-face {
  font-family: "DeviceSans";
  src: url("fonts/DeviceSans-Regular.ttf");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "DeviceSans";
  src: url("fonts/DeviceSans-Bold.ttf");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "DeviceSans";
  src: url("fonts/DeviceSans-Italic.ttf");
  font-weight: 400;
  font-style: italic;
}

#title {
  font-family: "DeviceSans";
  font-size: 24px;
  font-weight: bold;
}
```

Every distinct `font-family` + resolved font file + `font-size` + variant becomes
one generated font asset. Reusing the same face and size across many nodes
shares one asset. Using the same face at `16px` and `24px` creates two assets
because each size is rasterized separately.

#### Exact subsetting and icon fonts

By default, generated fonts use `font-subset: exact`. Only the literal
characters found in static UI text, placeholders, and option labels are encoded.
This is useful for icon fonts and symbol fonts:

```html
<text id="wifiIcon">✓</text>
```

```css
@font-face {
  font-family: "DeviceIcons";
  src: url("fonts/device-icons.ttf");
}

#wifiIcon {
  font-family: "DeviceIcons";
  font-size: 20px;
  font-subset: exact;
}
```

In this case, only the checkmark glyph is emitted for that font/size, not the
whole icon font and not the common ASCII set.

Generated font glyph lookup supports UTF-8 text for codepoints in the Basic
Multilingual Plane (`U+0000` to `U+FFFF`). Many icon fonts use Private Use Area
codepoints such as `U+E000`; those are supported. Emoji and other characters
above `U+FFFF` are not currently supported by the generated-font runtime.

Wingdings-style fonts can work, but be careful: some older symbol fonts use
legacy character mappings rather than standard Unicode symbols. Copy the exact
character/codepoint that the font maps to the glyph you want, or prefer a
Unicode icon font when possible.

#### Dynamic text and fallback glyphs

Exact subsetting can only see text known at build time. If a generated font is
used on a node whose text changes at runtime, include a fallback character set:

```css
#counter {
  font-family: "DeviceSans";
  font-size: 18px;
  font-subset: fallback;
}
```

`font-subset: fallback` includes the static text plus a small common ASCII set
containing digits, letters, spaces, and punctuation. Use it for counters,
formatted numeric values, input fields, or any generated-font text binding that
can produce characters not present in the initial HTML.

If the node uses the built-in bitmap font, `font-subset` has no effect.

#### Smoothing

Generated TTF/OTF glyphs are rasterized as alpha masks. Use
`font-smoothing: antialiased` to blend edge pixels for smoother text on RGB
displays. Use `font-smoothing: none` to threshold the same glyph masks for a
sharper, more pixel-like look. On monochrome displays smoothing is disabled.

```css
.smooth {
  font-family: "DeviceSans";
  font-size: 18px;
  font-smoothing: antialiased;
}

.sharp {
  font-family: "DeviceSans";
  font-size: 18px;
  font-smoothing: none;
}
```

#### Converting fonts

Use TTF or OTF files when possible. WOFF/WOFF2 web fonts should be converted to
TTF/OTF before use.

Common conversion options:

- FontForge GUI: open the source font, then use `File -> Generate Fonts...` and
  choose TrueType (`.ttf`) or OpenType (`.otf`).
- FontForge CLI:

```bash
fontforge -lang=ff -c 'Open($1); Generate($2)' input.otf output.ttf
```

- WOFF2 tools: use `woff2_decompress input.woff2` to produce a TTF-flavored
  font when the source is a WOFF2 web font.
- fonttools can inspect and subset fonts:

```bash
python -m pip install fonttools brotli
pyftsubset DeviceSans.ttf --text="ABC123" --unicodes=U+2713 --output-file=DeviceSans-subset.ttf
```

Manual external subsetting is optional. TypeCAD already subsets the emitted
hardware glyphs. External subsetting is mainly useful when you need to distribute
a smaller source font file, remove unused font tables for licensing reasons, or
speed up build-time parsing of a very large font.

#### Licensing

Do not assume system fonts are redistributable. Fonts such as commercial OS
fonts may be licensed for local use but not for checking into a repository or
shipping in a firmware project. Prefer open-licensed fonts, or keep proprietary
fonts outside shared source control if your license requires it.

#### Visual
| Property | Values | Notes |
|---|---|---|
| `background` / `background-color` | any color | Fill color |
| `border` (shorthand) | `2px solid #808080` | Splits into width/style/color |
| `border-width` | `2px` | |
| `border-color` | any color | |
| `border-style` | `solid`, `dashed`, `none` | Dashed approximated with segments |
| `border-radius` | `4px` | Rounded fill/border on hardware; preview approximates |
| `outline` | `1px solid #fff`, `2px dashed red` | Drawn outside the element box |
| `visibility` | `visible`, `hidden` | Hidden elements are not drawn |
| `box-shadow` | `inset 0 1px 0 #fff`, `0 10px 0 #333` | Up to 4 rect shadows; approximated for TFT drawing |
| `transform` | `translateY(10px)`, `translate(0, 10px)` | Draw-time translate offset; no flex relayout |
| `opacity` | parsed | (Blending not supported without PSRAM framebuffer) |

#### Transitions
| Property | Values | Notes |
|---|---|---|
| `transition` | `background 300ms`, `color 120ms` | Lerps the property over the duration |
| `:pressed` | pseudo-class | Applied when `.value` is 1 (button press) |

Pressed rules may also include `top` / `left` / `right` / `bottom` or
`transform: translate(...)`. These are applied as draw-time offsets so the
element face/content can move visually without recomputing the flex layout;
outset shadows stay anchored, which is useful for raised button effects.

Small dirty paint regions for text, backgrounds, borders, outlines, shadows,
and draw-time translate offsets are composed in an offscreen RGB565 canvas and
pushed as one rectangle when memory allows. Larger regions fall back to direct
drawing.

### Selectors
- Element: `screen { ... }`
- ID: `#title { ... }`
- Class: `.card { ... }`
- Compound: `.card.active { ... }`, `button.primary { ... }`
- Descendant: `view text { ... }`
- Child: `view > text { ... }` (direct children only)
- Adjacent sibling: `.first + .second { ... }` (immediate next sibling)
- General sibling: `.first ~ .later { ... }` (any following sibling)
- Attribute: `[disabled]`, `[type="number"]` (presence and exact-value match)
- Negation: `button:not(.disabled)`, `.a:not(.b.c)` (compound `:not()` supported)
- Pseudo-state: `#btn:pressed`, `input:disabled`, `check:checked`, `*:focus`
- Inline style: `<text style="color: red">hi</text>`
- `<style>` blocks embedded in the `.ui.html`

Pseudo-states match runtime element state: `:pressed` (button held), `:disabled`
(`disabled` attribute), `:checked` (`<check>`/`<radio>` with `.value` 1), and
`:focus` (the node currently receiving input).

### CSS variables

Define variables in `:root` and reference them with `var()`:

```css
:root {
  --bg: #0a0a0a;
  --fg: #fafafa;
  --primary: #7c3aed;
}
screen { background: var(--bg); }
#title { color: var(--fg); }
```

Variables resolve at transpile time — no runtime cost.

#### Class-scoped variables (themes)

Variables can also be defined under a class selector (e.g. `.dark`) and selected
at build time via the `themeClass` config option. This is how shadcn-style
light/dark themes work:

```css
:root { --bg: #ffffff; --fg: #0a0a0a; }
.dark { --bg: #0a0a0a; --fg: #fafafa; }
screen { background: var(--bg); color: var(--fg); }
```

```typescript
// cuttlefish.config.ts — or the display config in ui.mount
display: {
  themeClass: 'dark',   // resolves var(--x) using the .dark overrides
}
```

When `themeClass` is set, `var()` substitution prefers that class's variables
over `:root`. This is **transpile-time selection** — one theme per firmware
build (there is no runtime theme switch on a fixed-screen device).

#### `@media` (compile-time variant selection)

`@media` rules are evaluated against the resolved display profile at transpile
time. Since each build targets one fixed screen size, this acts as a
compile-time variant selector, not responsive design:

```css
/* Applied only when the display is ≤ 240px wide */
@media (max-width: 240px) {
  #title { font-size: 12px; }
}
```

Supported conditions: `min-width`, `max-width`, `min-height`, `max-height`
(in `px`). Unsupported conditions (e.g. `orientation`) emit a warning and the
rule is skipped. `@import` and `@supports` are not supported (warned + skipped).

### Theming

Themes are **compile-time**. There are two complementary mechanisms:

**1. Theme file (`themeCss`)** — swap the entire CSS file:

```typescript
// cuttlefish.config.ts
display: {
  themeCss: './src/hello.dark.css',  // relative to .ui.html dir
  // or: themeCss: '/absolute/path/to/theme.css',
}
```

When `themeCss` is set, that file replaces the default sibling `.ui.css`. Use CSS variables to define a palette once, then swap the variable file for different themes:

```
src/
  hello.ui.html       ← layout (shared)
  hello.ui.css         ← default theme (no themeCss set)
  hello.dark.css       ← dark theme
  hello.shadcn.css     ← shadcn palette
```

**2. Theme class (`themeClass`)** — select a class-scoped variable block
within a single CSS file (see [Class-scoped variables](#class-scoped-variables-themes) above):

```typescript
display: {
  themeClass: 'dark',  // resolves var(--x) from .dark { ... } overrides
}
```

The two can be combined: `themeCss` picks the file, `themeClass` picks the
variable scope within it.

The `.ui.html` file defines the structure (elements, IDs, layout); the CSS file defines the appearance (colors, fonts, borders, shadows). Swap either in config without touching the HTML.

### Unsupported (and why)
- `display: grid` — needs a GridLayoutEngine
- Full inline rich text — basic wrapping, `line-height`, `white-space`, and `<br>` are supported; mixed inline spans are not
- `background-image` / sprites — use `<img>` for embedded images; CSS `background: url(...)` is unsupported (only solid colors and `linear-gradient`)
- `position: fixed` — viewport-fixed positioning is not implemented
- `:after` / `:before` pseudo-elements — no generated content
- `text-shadow` on built-in font — needs sub-pixel font data (works with custom fonts)
- Per-corner `border-radius` — only a uniform radius is supported (Adafruit_GFX draws one corner value)
- Runtime theme switching — themes are compile-time only (one `themeClass` per build; swap in config and rebuild)

## State and interaction

### The `.value` property

Every interactive element has a `.value` property — a number that is both readable and writable:

```typescript
// Read
const count = screen.counter.value;

// Write (updates the display immediately)
screen.counter.value = 42;
```

### Pin input

```typescript
// Watch a pin for falling edges — runs in the frame loop (no ISR)
ui.watchPin(4, () => {
  screen.counter.value = screen.counter.value + 1;
});

// Toggle an element's .value on pin press (0 ↔ 1)
screen.ledBox.onToggle(5);

// Cycle through options (0 → 1 → 2 → 0 → ...)
screen.modeSelect.onChange(15, 3);
```

### Reactive bindings

Bindings compute a display property from `.value` or signals each frame:

```typescript
// Color binding
ui.bind(screen.counter, 'color', () =>
  (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange')
);

// Background binding
ui.bind(screen.btn, 'background', () =>
  (screen.btn.value > 0 ? 'limegreen' : 'darkgreen')
);

// Border color binding
ui.bind(screen.ledBox, 'borderColor', () =>
  (screen.ledBox.value ? 'limegreen' : '#808080')
);

// Value binding — drive a progress/range node live from loop()
ui.bind(screen.progress, 'value', () => sensorPercent);

// Visibility binding - preallocate both branches and toggle which one draws
ui.bind(screen.enteredBranch, 'visible', () => screen.input.value > 0);
ui.bind(screen.emptyBranch, 'visible', () => screen.input.value === 0);

// Text binding — number to string
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Text binding — ternary chain (for selectors)
ui.bind(screen.modeValue, 'text', () => (
  screen.modeValue.value === 0 ? 'Auto' :
  screen.modeValue.value === 1 ? 'Manual' : 'Off'
));
```

`visible` bindings are for fixed-layout conditional rendering. The nodes stay in
the retained UI tree; hidden branches are skipped for drawing and hit testing,
and shown branches repaint their subtree.

### Two-way input binding

When the user types into an `<input>` via the on-screen keyboard, push the text
back into app state with `ui.bindInput`:

```typescript
let ssid = '';
ui.bindInput(screen.ssid, (text) => { ssid = text; });
```

The callback fires whenever the input's text changes (after the keyboard commits).

### Slider change callbacks

A `<range>` fires `onChange` on every value change while dragging — read
`.value` inside the callback for the new value:

```typescript
screen.brightness.onChange(() => {
  // Fires continuously during the drag.
  ledPwm = screen.brightness.value;
});
```

### Data-bound lists

`<list>` is a virtualized, callback-driven list — it renders only the visible
items to a dedicated scroll canvas, so a thousand-item list has the same memory
footprint as a ten-item one. Bind it with `ui.bindList`:

```html
<list id="networks" item-height="28px"></list>
```

```typescript
ui.bindList(
  screen.networks,
  () => scanResults.length,                          // count
  (i) => `${scanResults[i].ssid} (${scanResults[i].rssi} dBm)`,  // item text
  (i) => { connectTo(scanResults[i].ssid); },        // optional tap handler
);
```

The count function re-evaluates each frame; if it changes, the list recomputes
its content height and repaints. Drag to scroll; tap an item to fire the
optional third callback.

### Signals

For reactive state not tied to an element:

```typescript
const temperature = ui.signal(22);

// Read
const t = temperature();

// Write
temperature.set(25);
```

## Composing custom elements

Don't see the element you need? Build it from `<view>` + `<text>` + bindings:

### Custom checkbox

```html
<view id="ledRow">
  <view id="ledBox"></view>
  <text id="ledLabel">Enable LED</text>
</view>
```
```css
#ledBox {
  width: 16px;
  height: 16px;
  border: 2px solid #808080;
}
```
```typescript
screen.ledBox.onToggle(5);  // toggles .value 0↔1

ui.bind(screen.ledBox, 'background', () =>
  (screen.ledBox.value ? 'limegreen' : 'transparent')
);
ui.bind(screen.ledBox, 'borderColor', () =>
  (screen.ledBox.value ? 'limegreen' : '#808080')
);
```

### Custom selector

```html
<view id="modeRow">
  <text id="modeLabel">Mode:</text>
  <text id="modeValue">Auto</text>
</view>
```
```typescript
screen.modeValue.onChange(15, 3);  // cycles 0→1→2→0

ui.bind(screen.modeValue, 'text', () => (
  screen.modeValue.value === 0 ? 'Auto' :
  screen.modeValue.value === 1 ? 'Manual' : 'Off'
));
```

### Custom progress bar

```html
<view id="barContainer">
  <view id="barFill"></view>
</view>
```
```css
#barContainer { width: 200px; height: 20px; border: 1px solid #808080; }
#barFill { background: limegreen; height: 100%; }
```
```typescript
ui.bind(screen.barFill, 'background', () =>
  (screen.barFill.value > 50 ? 'limegreen' : 'orange')
);
```

## Timers

```typescript
// Auto-update every 2 seconds
setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 2000);
```

## Architecture

```
.ui.html / .ui.css  →  parse (linkedom + css-tree)  →  resolve styles
                         ↓
                    layout (Yoga flexbox)
                         ↓
                    lower to C++ UINode[] table
                         ↓
              ui_mount → display.init (Adafruit_ILI9341)
              ui_tick  → poll inputs → eval bindings → transitions → draw
              ui_init  → mark all dirty for first frame
```

The runtime is a retained-mode tree: the HTML/CSS is fully resolved at transpile time. The device only sees static tables + a tiny draw loop. No DOM, no CSS engine, no HTML parser on the MCU.

### Rendering & performance

Each frame, `ui_tick` re-evaluates bindings, advances transitions/animations,
and redraws only the nodes marked dirty (most frames touch a handful of nodes,
not the whole screen). Dirty paint regions are composed in an offscreen RGB565
canvas and pushed as one rectangle when memory allows.

**Framebuffer (PSRAM-gated).** When the board has PSRAM (`BOARD_HAS_PSRAM`
defined + `psramFound()`), the runtime allocates a full-screen `GFXcanvas16`
framebuffer and renders the entire dirty-node pass into it, then pushes once
via a single SPI transaction. This eliminates the per-primitive transaction
storm that otherwise limits redraw rate on ILI9341 over SPI. Without PSRAM the
runtime falls back to direct per-node drawing (no behavior change). The
framebuffer activates automatically — no config needed beyond enabling PSRAM in
the Arduino build flags.

### Diagnostics (warnings)

Unknown HTML tags and unknown CSS properties are **reported as warnings**, not
silently dropped. They appear in the build output (yellow, to stderr) and do
not abort the build:

```
⚠ Unknown CSS property "bogus-prop" — ignored.
⚠ Unknown HTML tag <marquee> — ignored.
⚠ Unsupported @media (orientation: portrait) has an unsupported condition — rule ignored.
```

This surfaces typos and unsupported features early instead of leaving styles
mysteriously unapplied.

## Display profiles

The display hardware is described in `cuttlefish.config.ts` under the `display` field. This drives all transpile-time decisions: dimensions, color format, rotation, SPI pins, backlight, and touch.

### Config reference

```typescript
// cuttlefish.config.ts
display: {
  // Either reference a built-in profile by name:
  profile: 'ili9341-spi',

  // Or inline everything:
  // driver: 'ili9341',
  // width: 320, height: 240,
  // colorFormat: 'rgb565',
  // rotation: 1,

  // Wiring (always project-specific)
  cs: 5,
  dc: 21,
  rst: 22,
  backlight: 17,       // optional — pin number for backlight

  // Antialiasing (optional)
  antialias: true,       // smooths shapes and text; text can opt out with font-smoothing:none

  // Theming (optional — compile-time)
  themeCss: './src/hello.dark.css',  // override the sibling .ui.css file
  themeClass: 'dark',                 // select a class-scoped variable block (.dark { ... })

  // Touch (optional)
  touch: {
    library: 'XPT2046_Touchscreen',
    cs: 14,             // touch controller CS pin
    irq: 2,             // optional — interrupt pin
    calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    minPressure: 10,
  },
}
```

### Profile fields

| Field | Type | Description |
|---|---|---|
| `profile` | string | Built-in profile name (e.g. `"ili9341-spi"`) |
| `driver` | string | Display driver id (e.g. `"ili9341"`) |
| `width` | number | Display width in pixels (after rotation) |
| `height` | number | Display height in pixels (after rotation) |
| `colorFormat` | `"rgb565"` \| `"mono"` | Color depth |
| `rotation` | number | 0=portrait, 1=landscape, 2-3=inverted |
| `backlight` | number | Backlight pin (optional) |
| `cs` / `dc` / `rst` | number | Display wiring pins |

### Built-in profiles

| Name | Display | Dimensions | Color | Touch |
|---|---|---|---|---|
| `ili9341-spi` | ILI9341 (SPI) | 320×240 | RGB565 | Add via `touch` config |

### Adding a new display

Adding a new display driver requires two parts: a **display profile** (the hardware config) and a **display adapter** (the generated C++ code that drives it).

#### 1. Register a display adapter

A display adapter is a TypeScript function that generates C++ code for a specific driver. Register it in a module that runs before the build:

```typescript
// my-project/display-adapters.ts
import { registerDisplayAdapter } from '@typecad/cuttlefish/api/shared/display-adapter';

registerDisplayAdapter('ssd1306', (display) => {
  return {
    includes: `#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>`,
    declaration: `Adafruit_SSD1306 __tc_display(128, 64, &Wire, -1);`,
    functions: [
      'static inline void display_init() {',
      '  __tc_display.begin(SSD1306_SWITCHCAPVCC);',
      '  __tc_display.clearDisplay();',
      '}',
      'static inline void display_fillScreen(uint16_t color) {',
      '  __tc_display.fillScreen(color ? 1 : 0);',
      '}',
      'static inline void display_startWrite() { }',
      'static inline void display_endWrite() { __tc_display.display(); }',
      'static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) { }',
      'static inline void display_writePixels(uint16_t* pixels, uint32_t count) {',
      '  // Convert RGB565 to monochrome and write',
      '  for (uint32_t i = 0; i < count; i++) {',
      '    __tc_display.drawPixel(i % 128, i / 128, pixels[i] ? 1 : 0);',
      '  }',
      '}',
    ].join('\\n'),
  };
});
```

The adapter must provide these 6 functions:

| Function | Purpose |
|----------|---------|
| `display_init()` | Initialize the display (begin, rotation, clear) |
| `display_fillScreen(color)` | Fill the entire screen with a color |
| `display_startWrite()` | Begin an SPI transaction (no-op for I2C) |
| `display_endWrite()` | End an SPI transaction / trigger refresh |
| `display_setAddrWindow(x, y, w, h)` | Set the active write region |
| `display_writePixels(pixels, count)` | Write a row of RGB565 pixels |

For monochrome displays, the adapter wraps each color argument with a conversion function. For e-ink, `display_endWrite()` triggers the refresh cycle.

#### 2. Create a display profile

```typescript
// displays/my-display.ts
import type { DisplayProfile } from '@typecad/cuttlefish/api/shared';

export const MY_DISPLAY: DisplayProfile = {
  driver: 'ssd1306',      // must match the adapter name
  width: 128,
  height: 64,
  colorFormat: 'mono',    // 'rgb565' or 'mono'
  rotation: 0,
};
```

#### 3. Reference it in config

```typescript
display: {
  driver: 'ssd1306',
  width: 128, height: 64,
  colorFormat: 'mono',
  rotation: 0,
}
```

#### 4. Import the adapter module before building

Make sure your adapter module is imported (side-effect import) so the registration runs:

```typescript
// cuttlefish.config.ts or main.ts
import './display-adapters';  // registers the 'ssd1306' adapter
```

#### Built-in adapters

| Driver | Display | Color | Notes |
|--------|---------|-------|-------|
| `ili9341` | ILI9341 (320×240) | RGB565 | Default, hardware SPI |

To add more built-in adapters, contribute a file to `packages/framework-arduino/src/graphics/` and register it.

## Touch input

Touch is configured via the `touch` field in the display profile. The system uses an adapter pattern: built-in libraries generate C++ automatically; custom libraries use a TypeScript adapter file.

### Built-in touch libraries

| Library | Controllers | Interface | Config |
|---|---|---|---|
| `XPT2046_Touchscreen` | XPT2046 (common ILI9341 shields) | SPI (shared with display) | `{ library, cs, irq? }` |
| `Adafruit_TouchScreen` | Resistive 4-wire | Analog (no SPI) | `{ library, analogPins: { xp, yp, xm, ym, rx } }` |
| `Adafruit_STMPE610` | STMPE610 (capacitive) | SPI or I2C | `{ library, cs }` |

### Config examples

**XPT2046 (most common with ILI9341 TFT shields):**

```typescript
display: {
  profile: 'ili9341-spi',
  cs: 5, dc: 21, rst: 22,
  touch: {
    library: 'XPT2046_Touchscreen',
    cs: 14,           // touch CS pin (separate from display CS)
    irq: 2,           // optional
    calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    minPressure: 10,
  },
}
```

**Adafruit resistive 4-wire:**

```typescript
touch: {
  library: 'Adafruit_TouchScreen',
  analogPins: { xp: 'A3', yp: 'A2', xm: 8, ym: 9, rx: 300 },
  calibration: { xMin: 100, xMax: 900, yMin: 100, yMax: 900 },
  minPressure: 10,
}
```

### Calibration

Calibration maps the touch controller's raw ADC values to display pixel coordinates. To calibrate your panel:

1. Add `Serial.printf("raw=(%d,%d,%d)\n", p.x, p.y, p.z)` to the touch poll
2. Touch the four corners of the screen and note the raw values
3. Set `xMin`/`xMax` from the left/right edges, `yMin`/`yMax` from the top/bottom

The transpiler handles rotation (axis swap + inversion) automatically based on the `rotation` field in the display profile.

### Touch events (onClick, onHold, onRelease)

```typescript
// Short tap (finger down + up within 600ms)
screen.btn.onClick(() => {
  console.log("tapped");
  screen.counter.value = screen.counter.value + 1;
});

// Long press (finger held ≥600ms)
screen.btn.onHold(() => {
  console.log("held");
});

// Finger lift (always fires after click or hold)
screen.btn.onRelease(() => {
  console.log("released");
});
```

The touch system implements a state machine:
- **50ms debounce** — prevents rapid re-triggering
- **Click** — touch down + up within 600ms
- **Hold** — touch held ≥600ms (fires once)
- **Release** — finger lifts (clears `.value` to 0)
- **Visual feedback** — `.value` set to 1 on touch down, 0 on release

Hit-testing walks nodes topmost-first and skips containers without click handlers.

### Custom touch adapters

For libraries not in the built-in list, write a TypeScript adapter:

```typescript
// my-touch-adapter.ts
import { SomeTouchLib } from '../lib/SomeTouchLib/SomeTouchLib';

const ts = new SomeTouchLib(14, 2);
ts.begin();

export const touch = {
  isTouched: () => ts.touched(),
  read: () => {
    const p = ts.getPoint();
    return { x: p.x, y: p.y, z: p.z };
  },
};
```

Reference it in config:

```typescript
touch: {
  adapter: './my-touch-adapter',
  calibration: { xMin: 100, xMax: 4000, yMin: 100, yMax: 4000 },
  minPressure: 10,
}
```

The adapter only provides raw `{x, y, z}` — the transpiler handles calibration, rotation, and coordinate mapping.

## GPIO input (buttons without touch)

For physical buttons on GPIO pins (no touchscreen required):

```typescript
// Watch a pin for falling edges — runs in the frame loop
ui.watchPin(4, () => {
  screen.counter.value = screen.counter.value + 1;
});

// Toggle an element's .value on pin press
screen.ledBox.onToggle(5);

// Cycle through options
screen.modeValue.onChange(15, 3);  // 3 options: 0→1→2→0
```

Natural debounce from the ~16ms frame rate — no ISR, no `volatile`.
