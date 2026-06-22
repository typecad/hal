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
| `font-size` | `16px` | Maps to GFX textSize 2 |
| `text-align` | `left`, `center`, `right` | Horizontal alignment within the box |
| `text-decoration` | `underline`, `none` | Underline drawn below text |
| `font-weight` | `bold`, `normal` | Parsed (visual effect limited) |

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

## Display drivers

Currently supported:
- **ILI9341** (SPI, RGB565) — via the Adafruit_ILI9341 library

See `packages/framework-arduino/DISPLAYS.md` for how to add new drivers.
