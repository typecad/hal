# TypeHAL UI / Graphics Library — Design Spec

**Date:** 2026-06-19
**Status:** Draft (pending user review)
**Approach:** HTML/CSS as authoring DSL, lowered at transpile time; retained reactive tree on device.

---

## 1. Intent

Add a UI-creation / display-graphics library to TypeHAL. Authors write real
`.ui.html` and `.ui.css` files plus a thin `.ts` binding layer. The transpiler
parses the markup, computes layout, and emits a compact, fixed-size C++ element
tree that runs on bare-metal microcontrollers (no DOM, no browser, no CSS engine
on the device). A retained-mode reactive runtime on the MCU re-renders bound
properties when they change.

The design follows the existing TypeHAL philosophy: TypeScript / authoring
constructs are erased or inlined at transpile time, and only a minimal C++
representation ships to the firmware.

## 2. Confirmed decisions

These were resolved during brainstorming and are load-bearing for the design:

1. **HTML/CSS as authoring DSL.** Real `.ui.html` / `.ui.css` source, lowered at
   transpile time. No CSS engine ships on the MCU.
2. **Backend-agnostic Display HAL.** Concrete display drivers (SSD1306,
   ILI9341, …) are deferred. The abstraction comes first; drivers are
   per-framework strategies.
3. **Retained tree + reactive binds.** A compact C++ element tree runs
   on-device. TS variables are bound to element properties so the tree
   re-renders when they change.
4. **Per-target profiles.** RAM budgets, node caps, color depth are per-target
   knobs exposed via the framework strategy (mirrors existing
   `isHeapAllocationUnsafe`, `promotesArrayLiteralsToStaticArray`, etc.).
5. **`id` → typed property** wiring (`screen.btn.onPress(D2)`). Element ids in
   the `.ui.html` resolve to typed properties on the imported tree. Typos are
   compile-time errors in the editor.
6. **Small CSS subset for v1.** Element / `#id` / `.class` selectors; box model,
   color, text, `:pressed`, `transition`. No `@keyframes`, no grid/flex engines,
   no media queries in v1.
7. **Flexbox-forward scaffolding.** v1 ships `BlockLayoutEngine` only, but the
   layout architecture is structured so that the next step lands directly in
   flexbox/grid without rewriting measure, the style tree, the node
   representation, the draw layer, or the HAL ops. See §6.
8. **`ui.bind(node, 'prop', fn)`** — string-based property name for the PoC
   (one primitive covers all properties; matches CSS property names). Accepted
   for PoC; revisit per-property methods later.
9. **Reactivity semantics:** on target change mid-transition, interrupt and
   re-lerp from the current value (natural CSS behavior).
10. **PoC driver:** ILI9341 over SPI (color, ESP32-class). SSD1306 is the
    fast-follow. Mono targets cannot exercise the red-text/green-bg demo, so
    they are out of the PoC.
11. **Framebufferless by default.** The runtime draws dirty rects directly to
    the panel each frame. This is what makes AVR viable. A full RGB565
    framebuffer is 150 KB and impossible on 2 KB SRAM. ESP32 framebuffer is a
    later optimization, not v1.
12. **Driver-authoring README is a scoped deliverable.** The PoC includes a
    README that explains how to add a new display driver end-to-end.

## 3. Architecture overview

Four logical layers, top-to-bottom. Only the bottom two ship to the MCU.

```
┌─ Authoring        .ui.html  .ui.css              (real files)
│  ↓ ui.mount(tree) + ui.signal(...) / ui.bind(...) in .ts
├─ Transpile-lower  new IR transformer parses HTML/CSS → computes layout
│                   → emits UINode[] static initializer + reactive binding glue
├─ Device runtime   tiny retained-mode tree in C++ (nodes in PROGMEM/flash)
│                   layout traversal + draw traversal + reactive diff
└─ Display HAL      new display.* / ui.* HALOpIR ops → framework strategies
                   map to SSD1306 / ILI9341 / … concrete drivers (per-target)
```

### Package layout

| Layer | Location | New / existing |
|---|---|---|
| Authoring types + helpers | new package `@typehal/ui` | New |
| HTML/CSS parsing + layout + C++ lowering | `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` + parser module | New (in cuttlefish) |
| Retained C++ runtime (tree, layout/draw/diff) | runtime header emitted by the framework, or vendored per target | New |
| Display drivers | `@typehal/framework-arduino` gains ILI9341 resolver in its strategy; `framework-native` gains a terminal/SDL preview backend | Extended |

### Reuse of existing seams

- **HAL authoring pattern.** The `@typehal/ui` package is authored like the
  existing `I2CBus` / `SPIBus` — TS wrapper classes that lower via semantic
  helpers, not ad-hoc raw C++.
- **`HALOpIR` union.** New `display.*` op variants are added to the existing
  discriminated union in
  `packages/cuttlefish/src/api/shared/hal-op-ir.ts`. Framework strategies
  translate them via the existing `resolveHALOperation()` seam.
- **`PlatformStrategy`.** A new `PlatformGraphicsStrategy` sub-interface exposes
  per-target graphics capacity and color format, mirroring how
  `promotesArrayLiteralsToStaticArray` already works.
- **Async / `loop` pump.** The reactive runtime hooks into the existing
  microtask / `loop`-injection runtime. No new scheduler.
- **Auto-generated declaration files.** The transpiler already emits
  `cuttlefish-env.d.ts`. The UI lowering emits `.ui.html.d.ts` siblings so the
  editor knows the shape of an imported tree.

### Net-new surface

The one genuinely greenfield piece is **asset discovery for `.ui.html` /
`.ui.css` imports**. No asset pipeline exists in cuttlefish today. The lowering
transformer resolves `import { screen } from './app.ui.html'` by reading and
parsing the sibling file at transpile time.

## 4. End-to-end trace — red "hello world", green background, animated button

This is the canonical PoC demo. It exercises layout, color, text, the
`:pressed` pseudo-state, and a CSS transition.

### Source the author writes

```html
<!-- app.ui.html -->
<screen>
  <text id="greeting">hello world</text>
  <button id="btn">Click me</button>
</screen>
```

`<screen>` is the document root: every tree has exactly one. Its box is the
display's full viewport (`{0,0,width,height}` from `ui.mount`), and it is the
container `BlockLayoutEngine` arranges children within. It renders as a
`NODE_FILL` (background color) and is always index 0 in `__ui_nodes`.
```css
/* app.ui.css */
screen    { background: #008000; padding: 8; }   /* green */
#greeting { color: #ff0000; font: 8x16; }        /* red */
#btn {
  background: #404040; color: #ffffff; padding: 4;
  transition: background 80ms;
}
#btn:pressed { background: #808080; }
```
```typescript
// app.ts
import { ui } from '@typehal/ui';
import { screen } from './app.ui.html';
import { D2 } from '@typehal';

ui.mount(screen, { display: 'ili9341', bus: SPI0, cs: D10, dc: D9, rst: D8 });
screen.btn.onPress(D2);
```

### What the transpiler does (host, build time)

The UI-lowering transformer runs five steps, none of which ship to the MCU:

1. **Parse** HTML → element tree: `screen[ text, button ]`.
2. **Parse** CSS → rule list; **match selectors** to nodes; produce a computed
   style per node.
3. **Compute layout** via `BlockLayoutEngine` (box model with `padding`). Final
   pixel boxes, e.g. `screen {0,0,240,320}`, `greeting {8,8,224,16}`,
   `btn {8,32,80,24}`.
4. **Resolve ids** → `screen.btn`, `screen.greeting` become typed property
   references pointing at node indices; a `.ui.html.d.ts` is emitted.
5. **Emit C++** — a static node array (PROGMEM on AVR), a transition table, and
   press wiring. `screen.btn.onPress(D2)` lowers to a GPIO falling-edge handler
   that flips a bool on the button node and arms its transition.

Emitted C++ (sketch):

```cpp
static const UINode __ui_nodes[] PROGMEM = {
  { /*screen*/   .box={0,0,240,320}, .bg=RGB565(0x00,0x80,0x00), .kind=NODE_FILL },
  { /*greeting*/ .box={8,8,224,16},  .fg=RGB565(0xff,0x00,0x00), .kind=NODE_TEXT,
                  .text="hello world", .font=&font_8x16 },
  { /*btn*/      .box={8,32,80,24},  .bg=RGB565(0x40,0x40,0x40), .fg=RGB565(0xff,0xff,0xff),
                  .kind=NODE_TEXT, .text="Click me", .font=&font_8x16 },
};

static const UITransition __ui_trans[] = {
  { .node=2, .prop=PROP_BG, .durationMs=80 },
};

void __ui_btn_on_press() {
  __ui_nodes[2].state.pressed = true;
  ui_mark_dirty(2);
}
// in setup(): attachInterrupt(digitalPinToInterrupt(2), __ui_btn_on_press, FALLING);
```

Colors are resolved to the target's color format (`RGB565` for ILI9341) at this
stage. No color conversion happens on the device.

### What the device runtime does (every frame)

Hooked into the existing async / `loop` pump. Three phases per frame:

**① Advance transitions.** For each armed transition, lerp the property one
step toward target. When D2 goes low → `pressed=true` → target bg becomes
`#808080` → over the next 80 ms (~5 frames at 16 ms) the bg lerps
`#404040 → #808080`. When D2 goes high → `pressed=false` → target reverts and
lerps back. This back-and-forth *is* the press/depress animation, driven
entirely by the transition table generated from the one CSS line. If a new
target arrives mid-transition, the runtime interrupts and re-lerps from the
current value (decision §2.9).

**② Draw traversal.** Walk `__ui_nodes`, redraw only dirty nodes:

```cpp
for (uint8_t i=0; i<NODES; i++)
  if (__ui_nodes[i].dirty || first_frame) {
    switch (__ui_nodes[i].kind) {
      case NODE_FILL: display_fill_rect(box, bg); break;
      case NODE_TEXT: display_draw_text(box, text, font, fg); break;
    }
    __ui_nodes[i].dirty = false;
  }
```

First frame draws green screen, red text, gray button. Subsequent frames redraw
only the button while its transition is active.

**③ Flush.** `display_flush()` pushes dirty rects to the panel.

### Where each concern runs

| Concern | Where it runs |
|---|---|
| HTML parse, CSS parse, selector match | Transpile time (host) — never on device |
| Box-model layout, final pixel coords | Transpile time |
| `transition` / `:pressed` → transition table | Transpile time (becomes data) |
| Color lerp each frame | Device runtime (~5 frames over 80 ms) |
| Draw calls (fill / text) | Device runtime, dirty nodes only |
| SPI / I2C bytes to the panel | Framework driver via `HALOpIR` |

The animation costs the author one CSS line and the device a 5-frame color lerp
on a single dirty node. No per-frame full redraw, no DOM, no CSS engine on the
MCU.

## 5. Authoring surface (`@typehal/ui`)

```typescript
import { ui } from '@typehal/ui';
import { screen } from './app.ui.html';

const temp = ui.signal(22);
temp.set(24);

ui.bind(screen.greeting, 'text', () => `${temp()}°C`);
ui.bind(screen.btn, 'visible', () => temp() < 30);

ui.mount(screen, { display: 'ili9341', bus: SPI0, cs: D10, dc: D9, rst: D8 });

screen.btn.onPress(D2);
screen.btn.onRelease(D2);
```

- **`ui.signal(v)`** lowers to a plain device variable plus a dirty flag.
  Mutating it marks bound nodes dirty.
- **`ui.bind(node, 'prop', fn)`** lowers to an entry in a per-tick binding
  table. Each tick the fn is re-evaluated; if the value differs from the node's
  current value, the node is marked dirty (and, for transition-able properties,
  the transition is armed). String-based property name is the PoC shape (§2.8).
- **`ui.mount(tree, opts)`** validates `opts.display` against the framework's
  `supportedDisplayDrivers()` at transpile time (fail-fast, like pin-conflict
  checks), bakes the tree, and attaches it to the resolved display HAL.
- **`node.onPress(pin)` / `onRelease(pin)`** lower to GPIO edge handlers that
  flip the node's `pressed` state and arm its transitions.
- **Typed `.ui.html` imports.** The lowering emits `.ui.html.d.ts` siblings so
  the editor knows `screen` has `.greeting` and `.btn` properties with the right
  element types. Typo an id → type error in the editor.

### CSS subset (v1)

**Selectors:** element, `#id`, `.class`, and the `:pressed` pseudo-state on the
last simple selector.

**Properties:** `padding`, `margin`, `width`, `height`, `color`,
`background`, `font`, `font-size`, `transition`. Only `transition` on color /
background properties is supported in v1 (no `@keyframes`).

Explicitly out of scope (v1): `@keyframes`, flexbox/grid, media queries,
images/sprites, fonts beyond the built-in, multiple simultaneous displays,
touchscreen input beyond GPIO edge → press.

## 6. Flexbox-forward layout architecture

The layout design is structured so the next step lands directly in flexbox /
grid without rewrites. v1 ships `BlockLayoutEngine` only; the scaffolding makes
flex a pure addition.

### Staged, pluggable layout engine

```
style tree  →  Measure pass  →  Arrange pass (engine)  →  computed boxes
 (CSS)         (intrinsic)      BlockLayoutEngine v1      (baked into nodes)
                                FlexLayoutEngine  v2 (next)
                                GridLayoutEngine  later
```

`LayoutEngine` is an interface:
`arrange(styleTree, measureFn) → boxes`. v1 selects `BlockLayoutEngine`
unconditionally. v2 selects `FlexLayoutEngine` when any node declares
`display: flex`.

### Flex-forward traps avoided

| Trap | How v1 dodges it |
|---|---|
| Layout math scattered inline | Single `LayoutEngine` interface; v1 = `BlockLayoutEngine`, flex = a second implementation, engine chosen on `display` |
| No measure pass | Ship a real `measure(node) → {w,h}` in v1 (block needs it for text anyway); flex reuses it for `flex-basis: content` |
| Baked-only boxes that can't re-layout | C++ node carries *both* resolved style and computed box; v1 draw reads only the box, but a future flex engine can re-run arrange against the style tree when content changes |
| CSS props as ad-hoc struct fields | One structured `Style` object holds the full property set now; v1 reads the box/color/font subset, ignores the rest; flex = populating already-existing fields |
| `display` property absent | `display` modeled explicitly in v1 (value: `block`); flex = `display: flex`; selector→style resolver already passes it through |

### Net v1 cost of being flex-ready

One interface (`LayoutEngine`), one measure function that has to exist anyway,
a `Style` type with a few ignored flex fields, and `display` modeled explicitly.
Essentially zero — these are all things the simple version wants regardless.

### Next step after PoC

Implement `FlexLayoutEngine` against the standing `LayoutEngine` interface,
populate flex fields during style resolution, switch the engine on
`display: flex`. No rewrite of measure, style tree, node representation, draw
layer, or HAL ops.

## 7. C++ runtime footprint & reactive model

Four pieces, all statically sized for flash / PROGMEM residency.

1. **Static node table** — the baked tree, read-only, in flash. Per node: kind
   tag, computed box `{x,y,w,h}`, resolved style (colors, font id, text
   pointer), and a small runtime slot (`dirty` bit, transition state). AVR uses
   `PROGMEM` + `pgm_read`; ESP32 uses ordinary `const`. Size per node ≈ 20–32
   bytes; a typical screen stays well under the flash budget.
2. **Binding table** — one entry per `ui.bind(...)` call:
   `{nodeIndex, property, fn_ptr}`. Evaluated each tick; if the computed value
   differs from the node's current value, marks the node dirty and (for
   transition-able properties) arms the transition. This is the entire
   reactivity mechanism — no scheduler, no vdom, no diffing structures on the
   device.
3. **Transition driver** — for each armed transition, lerps the property toward
   target over `durationMs`, then clears dirty. Interrupt-and-re-lerp from
   current value on target change (§2.9). State is a handful of scalars per
   active transition.
4. **Draw + flush traversal** — walks the node table, redraws dirty nodes only,
   flushes dirty rects. Reuses the existing async pump. **Dirty-rect
   collection:** as each dirty node is redrawn in phase ②, its computed box is
   pushed onto a frame-local dirty-rect list; phase ③ passes that list to
   `DisplayFlushOp`. Adjacent/overlapping dirty boxes may be coalesced by the
   driver in `resolveDisplayOp` (e.g. ILI9341 can merge boxes sharing a row
   band). On AVR, the list is a small fixed-cap array (bounded by
   `maxActiveTransitions` + redraws-per-frame).

**Per-node, per-frame cost:** zero when idle; for the animated button, ~5 lerps
+ one `fill_rect` redraw per frame over 80 ms. No allocation, no heap. The
runtime is statically allocated, so it works on AVR as much as on ESP32; the
*capacity* (max nodes, max bindings, color depth) is what the per-target profile
sets.

## 8. Display HAL ops & backend abstraction

Draw calls become new `HALOpIR` variants added to the union in
`packages/cuttlefish/src/api/shared/hal-op-ir.ts`. Frameworks translate them via
the existing `resolveHALOperation()` seam.

### New ops (v1)

```typescript
| DisplayInitOp        // display.init      { bus, cs, dc, rst, width, height, driver }
| DisplayFillRectOp    // display.fill_rect { x, y, w, h, color }
| DisplayDrawTextOp    // display.draw_text { x, y, text, fontId, color }
| DisplayDrawRectOp    // display.draw_rect { x, y, w, h, color }   // outlines
| DisplayFlushOp       // display.flush     { dirtyRects[] }
```

Five ops cover the hello-world trace fully. Colors are resolved at transpile
time to the target's color format, so the runtime never does color conversion.

### New strategy sub-interface

```typescript
export interface PlatformGraphicsStrategy {
  /** Resolve a display HAL op to target-specific C++. Return undefined to fall back. */
  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined;
  /** Declare which display drivers this framework provides (mount-time validation). */
  supportedDisplayDrivers(): ReadonlySet<string>;   // e.g. new Set(['ili9341','ssd1306'])
  /** Target color format — drives transpile-time color resolution. */
  colorFormat(): 'rgb565' | 'mono';
}
```

`resolveDisplayOp` mirrors the existing `resolveHALOperation(op: HALOpIR)` seam.
`framework-arduino` implements it for ILI9341 (SPI commands) / SSD1306 (I2C
bitpack writes, fast-follow). `framework-native` implements it with a
**terminal-cell preview backend** (ANSI-colored node-tree render, no native
dependencies, runs anywhere Node runs) so the UI can be previewed without a
board. A higher-fidelity SDL backend is a later option, not v1.

### Backend-agnostic payoff

The same `DisplayFillRectOp` lowers to `setAddrWindow + SPI.transfer16`
(ILI9341), `Wire.write(page bytes)` (SSD1306), or `mvaddch` (native). Color
conversion happens once at transpile time against `colorFormat()`, not
per-frame. The author's `.ui.html` / `.ui.css` / `.ts` is identical across all
three.

### Framebufferless by default (decision §2.11)

The runtime draws dirty rects directly to the panel each frame. No framebuffer
in v1 — this is what makes AVR viable (a full 240×320 RGB565 framebuffer is
150 KB, impossible on 2 KB SRAM). ESP32 framebuffer is a later optimization.

## 9. Per-target profiles

Graphics capacity is a framework-strategy concern, mirroring existing knobs.

| Knob | AVR (Uno, 2 KB SRAM) | ESP32 (320 KB SRAM) | Native |
|---|---|---|---|
| `maxNodes` | 16 | 256 | unlimited |
| `maxBindings` | 8 | 64 | unlimited |
| `maxActiveTransitions` | 2 | 32 | unlimited |
| `colorFormat` | mono (1-bit) | rgb565 | rgb565 |
| `framebufferless` (default) | required | yes (v1) | yes |
| `nodeStorage` | PROGMEM + `pgm_read` | `const` in flash | `const` |

These ride on `PlatformGraphicsStrategy` (the capacity values are returned by
strategy methods on that interface). If an author's `.ui.html` tree exceeds
`maxNodes` for the active target, the transpiler emits a **diagnostic at build
time** — "tree has 24 nodes, AVR max is 16" — not a runtime crash on the board.
Same fail-fast philosophy as the existing pin-conflict checks.

**Scope note on the AVR row:** the PoC driver is ILI9341 (SPI, rgb565,
ESP32-class), so AVR capacity is *specified* here for completeness and for the
fail-fast diagnostic, but is *not exercised* by the PoC. AVR ships a mono
profile so an SSD1306 (I2C) fast-follow can target it directly; nothing in the
PoC depends on AVR actually driving a color panel.

## 10. PoC scope (v1)

### In scope

1. `.ui.html` + `.ui.css` parsing — element / `#id` / `.class` selectors, the
   box-color-font-transition property subset, `:pressed` pseudo-state.
2. `BlockLayoutEngine` with full flex-forward scaffolding (`LayoutEngine`
   interface, measure pass, `display` modeled, `Style` type ready for flex
   fields).
3. Lowering to static C++ node table + binding table + transition table
   (PROGMEM on AVR).
4. Reactive runtime: signal / bind, per-tick evaluation, interrupt-and-re-lerp
   transitions.
5. Five `DisplayHALOp` variants + `PlatformGraphicsStrategy`; one concrete
   driver (ILI9341 over SPI in `framework-arduino`) plus the `framework-native`
   terminal-cell preview backend.
6. The hello-world trace (red text, green bg, animated button on D2) compiling
   and running end-to-end.
7. Auto-generated `.ui.html.d.ts` for typed id imports.
8. **README documenting how to add a new display driver** (see §11).

### Out of scope (v1, with explicit next steps)

- Flexbox / grid engines (scaffolded, not implemented) — next step per §6.
- `@keyframes`, media queries.
- Images / sprites / fonts beyond the built-in.
- Multiple simultaneous displays.
- ESP32 framebuffer optimization.
- Touchscreen input (GPIO edge → press only for now).
- SSD1306 / other concrete drivers (fast-follow after ILI9341).

## 11. Driver-authoring README

A scoped deliverable of the PoC, placed at `packages/framework-arduino/README.md`
(or a dedicated `DISPLAYS.md` if the existing README grows too large). It will
document, end-to-end:

1. **The `PlatformGraphicsStrategy` interface** — what each method must return
   and when the transpiler calls it.
2. **The five `DisplayHALOp` variants** — fields, semantics, and what each
   lowers to in driver terms.
3. **Registering a driver** — how to add a driver id (e.g. `'ssd1306'`) to
   `supportedDisplayDrivers()` and wire it into `resolveDisplayOp()`.
4. **Color format** — how `colorFormat()` drives transpile-time color
   resolution and what the driver receives at runtime.
5. **A worked example** — adding SSD1306 (I2C, mono) as the canonical second
   driver, contrasted with the existing ILI9341 (SPI, rgb565) implementation.
6. **Mount-time validation** — how `ui.mount({ display })` fails fast at
   transpile time against `supportedDisplayDrivers()`.

The README will use the same structure as the existing
`packages/framework-arduino/README.md` (Overview / Quick start / How to use /
code-reference tables).

## 12. Testing

Following the existing monorepo convention (Vitest):

- **Parser tests** — HTML/CSS subset parsing, selector matching, `:pressed`.
- **Layout tests** — `BlockLayoutEngine` box math on representative trees;
  flex-forward invariants (measure called, `display` honored, `Style` carries
   flex fields unused).
- **Lowering tests** — assert the emitted C++ node table / binding table /
  transition table for the hello-world tree; assert `.ui.html.d.ts` contents.
- **Driver tests** — `resolveDisplayOp` output for ILI9341 across all five ops;
  `framework-native` preview backend sanity.
- **Transpile-time diagnostics** — `maxNodes` / `maxBindings` exceeded,
  unsupported `display` driver, unknown CSS property / selector.
- **End-to-end** — the hello-world `.ts` + `.ui.html` + `.ui.css` transpiles
  and the generated C++ contains the expected draw calls (asserted on emitted
  text, since there is no hardware in CI).
