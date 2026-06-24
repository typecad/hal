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
| `box-sizing` | `border-box` | Yoga border-box |
| `overflow` | `hidden` | Clips children |

#### Flexbox (via Yoga)
| Property | Values |
|---|---|
| `display` | `flex` |
| `flex-direction` | `row`, `column` |
| `gap` | `8px` |
| `flex-grow` | `1` |
| `flex-shrink` | `0` |
| `flex` (shorthand) | `1`, `1 0 auto`, `none` |
| `align-items` | `flex-start`, `center`, `flex-end`, `stretch` |
| `align-self` | `flex-start`, `center`, `flex-end`, `stretch` |
| `justify-content` | `flex-start`, `center`, `flex-end`, `space-between`, `space-around`, `space-evenly` |
| `flex-wrap` | `wrap`, `nowrap`, `wrap-reverse` |
| `order` | `1`, `2`, ... |
| `position` | `relative`, `absolute`, `static` |
| `top` / `right` / `bottom` / `left` | `10px` |

#### Colors
All standard CSS color formats are supported:
- `#rrggbb` — `#ff0000`
- `#rgb` — `#f00`
- `#rrggbbaa` — `#ff0000ff` (alpha ignored)
- `rgb(r,g,b)` — `rgb(255, 0, 0)`
- `rgba(r,g,b,a)` — `rgba(255, 0, 0, 0.5)` (alpha ignored)
- Named colors — `red`, `dodgerblue`, `limegreen`, `transparent`, ... (147 CSS named colors)

#### Typography
| Property | Values | Notes |
|---|---|---|
| `color` | any color | Text foreground color |
| `font-family` | `"MyFont"` | Uses a generated font when matched by `@font-face`; otherwise the built-in bitmap font |
| `font-size` | `16px` | Generated fonts are rasterized at this pixel size; bitmap text maps to GFX text size |
| `font` | `italic bold 18px DeviceSans` | Shorthand support for style, weight, size, and family |
| `text-align` | `left`, `center`, `right` | Horizontal alignment within the box |
| `text-decoration` | `underline`, `none` | Underline drawn below text |
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
| `border-radius` | `4px` | Parsed (visual rendering limited) |
| `visibility` | `visible`, `hidden` | Hidden elements are not drawn |
| `opacity` | parsed | (Blending not supported — no framebuffer) |

#### Transitions
| Property | Values | Notes |
|---|---|---|
| `transition` | `background 300ms` | Lerps the property over the duration |
| `:pressed` | pseudo-class | Applied when `.value` is 1 (button press) |

### Selectors
- Element: `screen { ... }`
- ID: `#title { ... }`
- Class: `.card { ... }`
- Pseudo-state: `#btn:pressed { ... }`

### Unsupported (and why)
- `box-shadow` — too expensive per-frame (no alpha blending)
- `linear-gradient` — banded approximation possible but deferred
- `@keyframes` — transition engine exists; keyframes are separate
- `display: grid` — needs a GridLayoutEngine
- Text wrapping / multi-line — no text layout engine
- `background-image` / sprites — needs asset pipeline
- `position: fixed` — no scrolling context
- CSS variables (`--custom`) — could be build-time resolved

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

// Text binding — number to string
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Text binding — ternary chain (for selectors)
ui.bind(screen.modeValue, 'text', () => (
  screen.modeValue.value === 0 ? 'Auto' :
  screen.modeValue.value === 1 ? 'Manual' : 'Off'
));
```

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

Create a profile file in your project or framework:

```typescript
// displays/my-display.ts
import type { DisplayProfile } from '@typecad/cuttlefish/api/shared';

export const MY_DISPLAY: DisplayProfile = {
  driver: 'ssd1306',
  width: 128,
  height: 64,
  colorFormat: 'mono',
  rotation: 0,
  // No SPI pins for I2C displays
  // No backlight
};
```

Reference it in config:

```typescript
display: {
  driver: 'ssd1306',
  width: 128, height: 64,
  colorFormat: 'mono',
  rotation: 0,
  cs: 0, dc: 0, rst: -1,  // I2C — these are ignored for I2C displays
}
```

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
