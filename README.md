# [TypeCAD](https://typecad.dev)

> **⚠️ Framework notice (alpha breaking change):** Arduino support has been
> **removed**. TypeCAD now targets **Zephyr RTOS** through a thin,
> Zephyr-shaped HAL — construction-fact classes (`GPIO`, `PWM`, `ADCChannel`,
> `I2CTarget`, `SPITarget`, `UART`, `Watchdog`, `Counter`, `Thread`, `Time`,
> `Sensor`) whose methods lower 1:1 onto Zephyr driver calls, with
> devicetree/Kconfig generated from your code. See `docs/hal/thin-hal.md` for
> the full surface and `demos/zephyr-*` for working programs.

- Write firmware in TypeScript. Ship it as C++.
- Type-safe, board-aware embedded development that catches hardware bugs before you flash — not after a 30-second upload cycle.


---

## Why TypeCAD?

Embedded firmware development has a feedback loop problem. You write C++, flash it to a board, and *then* discover you passed the wrong pin, forgot to initialize a bus, or used a pin that's already claimed by I2C. Every mistake costs a compile-flash-test cycle.

TypeCAD moves those checks into your editor. You write TypeScript against typed hardware abstractions that know which pins support PWM, which pins are shared with SPI, and whether your I2C bus was initialized before you tried to read from it. If something's wrong, you see the red squiggle immediately — not a blank serial monitor thirty seconds later.

```typescript
import { LED } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);   // → k_msleep(1000)
}
```

That's a complete Zephyr program. `new GPIO(LED, GPIO.OUTPUT)` carries construction facts to the generated devicetree; `led.toggle()` lowers to the driver's atomic `gpio_pin_toggle_dt`. No extra variables, no overhead.

## Catch hardware mistakes in your editor

Every pin has a narrow type that reflects what it can actually do on your board.

```typescript
import { PB6, PA0 } from '@typecad/board';
import { PWM, ADCChannel } from '@typecad/hal';

new PWM(PA0, { periodNs: 20_000_000 });
// Error: PA0 has no PWM route on this board (PB6 does)

const sense = new ADCChannel(PA0);
sense.read();  // OK — raw counts at the chip's resolution
```

The transpiler also detects alias conflicts — two names that resolve to the
same physical pin — and peripheral usage that collides with pins the board's
own controllers claim.

These are not linter hints. They're type errors and transpiler diagnostics rooted in your board's actual pinmux.

## Peripherals with state

Calling `.device()` on an uninitialized bus is a compile-time error.

```typescript
import { I2C0 } from '@typecad/board';

const sht = I2C0.device(0x76);
sht.readReg(0xFA); // OK — no begin() to forget; construction configures everything
```

Buses have nothing to initialize: thin devices carry their facts (address, CS, speed) in the constructor and the generated devicetree enables the controllers.

## One command to flash

```bash
npx typecad-hal sketch.ts --compile --upload --monitor --port COM4
```

Transpile, compile, upload, and open a serial monitor in a single invocation. Or use the individual flags — `--compile` only, `--compile --upload` only — whatever fits your workflow.

## Supported boards

Boards come from a generated data pack extracted from the Zephyr board tree — **1,300+ board variants** work out of the box, each with datasheet-named pins, LED/BUTTON aliases, and connector maps generated into your project on first build. The nine hardware-validated targets:

| Board | `board:` target | Silicon |
|---|---|---|
| ESP32 DevKit | `esp32_devkitc/esp32/procpu` | ESP32 (Xtensa LX6) |
| ESP32-S3 | `esp32s3_devkitc/esp32s3/procpu` | ESP32-S3 (Xtensa LX7) |
| ESP32-C3 | `esp32c3_devkitm/esp32c3` | ESP32-C3 (RISC-V) |
| ESP32-C6 | `esp32c6_devkitc/esp32c6/hpcore` | ESP32-C6 (RISC-V, Wi-Fi 6) |
| RP2040 (Pico) | `rpi_pico/rp2040` | RP2040 (ARM Cortex-M0+) |
| RP2350 (Pico 2) | `rpi_pico2/rp2350a/m33` | RP2350 (ARM Cortex-M33) |
| Black Pill (STM32F411) | `blackpill_f411ce/stm32f411xe` | STM32F411 (ARM Cortex-M4F) |
| XIAO nRF52840 | `xiao_ble/nrf52840` | nRF52840 (ARM Cortex-M4F) |
| Arduino Nano 33 IoT | `arduino_nano_33_iot/samd21g18a` | SAMD21 (ARM Cortex-M0+) |

Custom PCBs use a *contract project*: set `soc:` (e.g. `'stm32f411xe'`) plus a board contract and the SoC's pinout generates locally. Arduino Uno/AVR support was removed with the legacy framework.

## Configure once

```typescript
// typecad-hal.config.ts
import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry:     './src/main.ts',
  board:     'esp32s3_devkitc/esp32s3/procpu',
  framework: '@typecad/framework-zephyr',
  output:    { outDir: './out' },
};

export default config;
```

The transpiler auto-generates `typecad-hal-env.d.ts` so your editor resolves the `@typecad/board` virtual import with full IntelliSense — no `tsconfig.json` changes needed.

## Zero-cost abstractions

TypeScript constructs that have no C++ equivalent are erased or inlined at transpile time:

- Pin aliases (`const led = LED`) produce no C++ variables
- `Shared<T>` phantom types emit C++ `const`
- `Owned<T>` / `Mutable<T>` types are fully erased
- Enums, classes with private fields, destructuring, template literals, typed arrays — all lowered to valid C++ for the target MCU

## Test on real hardware

```typescript
import { describe, done } from '@typecad/hal/testing';
import { ADC_PIN, ADC_MAX } from '@typecad/test-pins';
import { ADCChannel } from '@typecad/board';

describe("Analog input")
  .it("reads within valid range")
  .expect((() => {
    const sense = new ADCChannel(ADC_PIN);
    return sense.read();
  })())
  .toBeWithinRange(0, ADC_MAX);

done();
```

These tests run on the actual microcontroller over serial — via
`typecad-hal build --expect` or the `typecad-hal test` CLI from `@typecad/expect`.
The host-side runner reports pass/fail from real pin states and sensor
readings — not mocks.

## Simulate without hardware

The in-memory simulator lets you develop and test firmware logic in Node.js before touching a board:

```typescript
import { createSimBoard } from '@typecad/hal/sim';

const board = createSimBoard({ digitalPinCount: 14 });
// Mock I2C devices, inject serial data, verify bus traffic
```

Register simulated I2C/SPI devices, inject data, and assert on operation logs — all without a physical board connected.

## Build hardware UIs with HTML + CSS

TypeCAD includes a compile-time UI framework: write HTML and CSS, and the transpiler generates C++ that renders directly on SPI TFT displays (ILI9341, ST7796S), OLED, and e-ink panels. No browser, no runtime interpreter — the markup compiles to the same retained-mode node tables and draw dispatch as hand-written display code.

### Single-file `.ui` components

Combine script, styles, and template in one file — the Svelte-compatible `.ui` format:

```html
<script>
  import { ui } from '@typecad/ui';

  ui.mount(screen, {
    display: 'ili9341',
    bus: 'SPI',
    cs: 5,
    dc: 21,
    rst: 22,
  });

  export const count = ui.signal(0);

  export function incrementTaps() {
    count.set(count() + 1);
  }
</script>

<style>
  #tapBtn {
    background: #3399ff;
    border: 2px solid #1a73e8;
    border-radius: 8;
  }
</style>

<screen id="counter" style="background: #ffffff">
  <text id="label">taps: {count}</text>
  <button id="tapBtn" on:click={incrementTaps}>tap me</button>
</screen>
```

The transpiler splits the `.ui` file into its three streams and feeds them through the existing HTML/CSS/TS pipelines. Set `entry: './src/app.ui'` in your config. `typecad-hal create` scaffolds the typeCAD/hal VS Code extension into the project's `.vscode/extensions/` folder — `.ui` highlighting (with snippets, file icons, and ` ```ui ` markdown fences, derived from the Svelte grammar) plus board-aware intelligence and the TypeCAD Debug tooling — so everything works on first open. VS Code 1.89+ prompts once to approve the workspace extension, and newer builds with the `forceInstall` feature install it silently; a watch task with problem matchers surfaces transpiler diagnostics in the Problems panel while `npm run dev` runs. For an existing project, run `node scripts/sync-typecad-ui.mjs` from a checkout, or copy `packages/cuttlefish/assets/editor-extensions/typecad-hal` into `.vscode/extensions/`.

### Declarative bindings

**Text interpolation** — reactive text from any signal or expression:

```html
<span>taps: {count}</span>
<text>temp: {sensorValue}°C</text>
```

The `{expr}` compiles to an implicit text binding that re-evaluates every frame. v1 defaults to numeric (`%d`); use `ui.bind` for string-type signals.

**Declarative events** — wire handlers in markup, name functions in script:

```html
<button on:click={saveSettings}>Save</button>
<range on:change={updateVolume}></range>
```

```typescript
export function saveSettings() { /* ... */ }
export function updateVolume() { /* ... */ }
```

The function name in the directive resolves to the C++ function the transpiler emits from your `export function` declaration. Supports `on:click`, `on:hold`, `on:release`, `on:change`.

**Two-way bindings** — form controls backed by signals:

```html
<input bind:text={ssid}></input>
<range bind:value={brightness}></range>
<check bind:value={enabled}></check>
```

The control reflects the signal (signal → UI), and user input writes back (UI → `signal.set`). Works for keyboard text input (`bind:text`) and range/check values (`bind:value`).

### `ref` — separate CSS identity from TS handles

```html
<button id="primaryButton" ref="saveButton" on:click={save}>Save</button>
```

CSS targets `#primaryButton`. TypeScript accesses `screen.saveButton`. When `ref` is absent, the handle falls back to `id` (backward-compatible).

### Grouped screen handles

When screens have `id` attributes, elements are grouped under `screen.groups.<screenId>.<handle>`:

```typescript
screen.groups.forms.formBtn   // grouped access
screen.formBtn                // flat access (backward-compatible)
```

This relieves naming pressure — two screens can both have `id="btn"` and they won't collide.

### CSS support

The transpiler resolves a substantial CSS subset at compile time:

- Flexbox layout (justify-content, align-items, flex-grow/shrink/basis, gap, order, wrap)
- Box model (width, height, padding, margin, border, border-radius; **always border-box**)
- Percentages (`width: 50%` resolves against the parent) and `margin: 0 auto` centering
- Typography (font-size, font-weight, font-style, line-height, letter-spacing, text-align, text-decoration, text-overflow, white-space)
- Colors (hex, rgb(), hsl(), oklch(), named colors, CSS variables, `var()` with theme classes — including shadcn themes pasted in unmodified: HSL channel triplets and oklch tokens both resolve)
- Shadows and outlines (box-shadow, outline)
- Transitions and animations (@keyframes, transition properties)
- Transforms (translate, scale, rotate, transform-origin)
- Gradients, opacity, visibility, z-index layering
- Rich text (inline bold/italic/underline/links with per-run styling)
- Scrolling containers (touch-drag scroll with rubber-band physics)

CSS variables with theme classes let you switch palettes at build time:

```css
:root { --bg: #ffffff; --fg: #000000; }
.dark { --bg: #1a1a2e; --fg: #e0e0e0; }
```

Set `themeClass: 'dark'` in the display config to activate the dark palette.

### Web compatibility: the same rules, visible differences

The engine follows browser semantics where it can and **tells you** where it can't — every approximation below surfaces as a `css-*` build warning (add `--strict-css` to make them errors):

| You write | What happens |
| --- | --- |
| `#id { … }` vs later `.class { … }` | Real cascade specificity: inline style > id > class/attribute > element; source order breaks ties. The UA sheet loses to any author rule. |
| `width: 50%`, `padding: 1px 2px 3px 4px` | Resolved against the parent / expanded TRBL like a browser. |
| `margin: 0 auto` | Centers the element in its parent (auto margins). |
| `background: transparent` | No fill — the parent shows through (not black). |
| `border: 1px solid` | Border color defaults to `currentColor` (the text color), like browsers. |
| Unknown tags (custom elements) | Rendered as generic containers with a warning — content is never dropped. `<li>` gets a `•`/`1.` marker. |
| `<table>` | Equal-width flex approximation: `tr` = row, `td`/`th` = stretched cells, `th` bold + centered. No auto column sizing or colspan (info/warnings emitted). |
| `<svg>`, `<video>`, `<audio>`, `<iframe>` | Not possible on MCUs — a specific warning says why and points at `<canvas>`/`<img>`; content still renders as containers. |
| Text next to elements (`<div>Total: <b>3</b></div>`) | Flows as one text line (anonymous boxes), like a browser. |
| `rgba(..., 0.5)` | Alpha is ignored (no blending on bare metal) — warned. |
| `display: inline-block` / `grid` | Not supported — elements stack vertically; warned. Use `flex-direction: row` + `gap` for inline flows. |
| `position: fixed` / `sticky` | Not supported — treated as static; warned. |
| `box-sizing: content-box` | Ignored — the engine is always border-box; warned. |
| `font-size: 1.2em` / `120%` | em/rem resolve against a 16px root; % is rejected; warned. |
| `:hover` | No hover on touch hardware — use `:active`/`:pressed`. |

Two deliberate non-inheritances match embedded reality: `text-decoration` doesn't inherit, and `:focus` is runtime-only (can't match statically).

### Default font and antialiasing

Color displays get bundled **DejaVu Sans** (regular + bold) and **DejaVu Sans Mono** (for `<pre>`/`<code>`/`<kbd>`) `@font-face`s automatically, so text is antialiased and every `font-size` renders at its exact pixel size from the first build — no font sourcing required. Declare your own `@font-face` under any family name (including the bundled ones) to replace them. Monochrome displays keep the built-in bitmap font, where sizes quantize to buckets (1–12/13–20/21–28/29+ px render identically — warned per use).

DejaVu ships under the permissive Bitstream Vera License (see [`packages/ui/assets/fonts/dejavu/LICENSE`](packages/ui/assets/fonts/dejavu/LICENSE)); the unmodified TTFs and that license file must travel together. Devices only ever receive build-time-rasterized glyph subsets, with an attribution comment stamped into the generated font tables.

### Display-anchored defaults

Browser defaults assume a desktop viewport. These UA defaults scale with your display so `h1 > h2 > p` hierarchies survive a 320×240 (or 128×64) screen:

| Display class | Root text | h1 | h2 | Touch-target min-height |
| --- | --- | --- | --- | --- |
| ≥480×320 color | 16px | 24px | 20px | 48px |
| 320×240 color | 14px | 21px | 18px | 42px |
| ≤160px color | 12px | 18px | 15px | 36px |
| Monochrome (≥96px tall) | 12px | 28px* | 20px | 32px |

\* snapped to the bitmap font's size buckets — only ~4 distinct sizes exist there.

Headings and paragraphs also carry browser-like vertical margins, and `button`/`input`/`select`/`check`/`radio` get the min-heights above. Override anything with your own CSS; every element keeps web-faithful semantics.

Framework layout classes from the UA sheet (documented, overridable): `.scrollBody` / `.ui-scroll-body` (scrollable centered card column) and `.screenHeader` / `.ui-screen-header` (back-link + title bar).

### shadcn-style component kit

The kit is **built into `@typecad/ui`** and prepended to every build and preview automatically — no scaffolding step, no import required: put the classes on native elements and they work. Your own styles override it by normal cascade order.

Pre-packaged themes ship with `@typecad/ui` — import them by bare specifier from any `<style>` block or sidecar stylesheet:

```css
@import "@typecad/ui/themes/blue.css";
```

Available theme files: `zinc`, `slate`, `stone`, `gray`, `neutral`, `blue`, `green`, `red`. Your own theme is any CSS file — save a ui.shadcn.com / tweakcn export into the project and `@import` it by path; its `:root`/`.dark` token blocks override the kit defaults.

The kit provides CSS-variable tokens (`--background`, `--primary`, `--muted-foreground`, `--border`, `--radius`, ...) in light + `.dark` sets (activate dark via `themeClass: 'dark'`), plus class recipes over the native elements:

| shadcn component | Recipe on native elements |
| --- | --- |
| Button (+ variants/sizes) | `.btn` `.btn-primary/-secondary/-outline/-ghost/-destructive` `.btn-sm/-lg/-block` on `<button>` |
| Badge | `.badge` + variants on `<text>` |
| Card | `.card` + `.card-header/-title/-description/-content/-footer` on `<view>`/`<text>` |
| Input / Label | `.input` / `.form-label` |
| Separator | `.separator` on `<hr>` |
| Alert | `.alert` + `.alert-destructive`, `.alert-title/-description` |
| Skeleton | `.skeleton` (opacity pulse) |
| Progress | `.progress` on `<progress>`/`<meter>` |
| Avatar | `.avatar` on `<img>` |
| Switch | `.switch` on `<check>` (pill container; indicator is runtime-drawn — best-effort) |
| Checkbox/Radio/Slider | native `<check>`/`<radio>`/`<range>` directly |
| Table | `<table>` (UA-styled) |
| Row (kit utility) | `.row` on `<view>` |
| Tabs, Dialog, Toast, Accordion, Tooltip | not CSS — need runtime state; deferred (Accordion maps to the planned `details`/`summary`) |

`@import` resolves local stylesheets — relative paths and bare `@typecad/ui/themes/*` specifiers — at build time (recursive, cycle-guarded; remote imports still warn). Token values are opaque-tuned for panels without alpha blending. The `demos/demo-shadcn` showcase has a live "shadcn Kit" screen built this way.

**Pasting a stock shadcn theme works unmodified** — replace the preset's `:root`/`.dark` token blocks with any theme from the shadcn generator or tweakcn. Both dialects resolve at build time: classic HSL channel triplets (`--primary: 222.2 47.4% 11.2%`, consumed as `var(--x)` or `hsl(var(--x))` alike) and Tailwind v4 era `oklch()` tokens (converted to sRGB). Extra tokens stock themes carry (`--ring`, `--chart-*`, `--sidebar-*`) are simply unused. Radius arithmetic like `calc(var(--radius) - 2px)` resolves correctly with rem or px tokens.


### Display-agnostic rendering

The same UI compiles for different display types via a capability descriptor:

```typescript
display: {
  profile: 'ili9341-spi',
  // For e-ink:
  // driver: 'ssd1680',
  // displayClass: 'eink',
  // colorFormat: 'mono',
}
```

Target e-ink with `@media` in your CSS:

```css
@media (e-ink) {
  .card { background: white; border: 2px solid black; box-shadow: none; }
  .danger { color: red; }
}
```

Supported `@media` features: `(e-ink)`, `(update: slow|fast)`, `(monochrome)`, `(monochrome: N)`, `(color-gamut: srgb|p3)`, plus width/height queries.

## The VS Code extension

Editor support ships as one extension — **typeCAD/hal** ([`packages/vscode-typecad-hal`](packages/vscode-typecad-hal), the merge of the former `.ui` grammar, TypeCAD Debug, and TypeCAD Intel extensions). `typecad-hal create` bundles its built form into every project's `.vscode/extensions/` (with a `forceInstall` entry), so no separate install is needed; run `npm run sync:typecad-ui` at the repo root to refresh the vendored copies after changing it. Three surfaces:

- **`.ui` language** — syntax highlighting, snippets, and file icons for `.ui` single-file components (declarative contributes, zero runtime).
- **Source-level debugging** — press F5 on a board whose probe facts carry a debug-capable method (openocd/jlink): the engine writes `launch.json` + `tasks.json`, the build task compiles and flashes with `--debug`, and VS Code's native debugger attaches over GDB. On boards without a debug-capable probe, `--debug` fails with an explicit diagnostic; print-state debugging via the serial console (`USB0.writeLine(...)` / `UART0.writeLine(...)`) works on every board.
- **Declaration generation** — saving a `.cpp` file auto-generates a `.d.ts` sidecar when one is missing (never clobbers); `TypeCAD: Generate Declaration from C++` generates for the active file.
- **Editor intelligence** — board-aware diagnostics and hovers with no build running: on every save the extension analyzes the project in no-emit mode through the project's *own* `@typecad/cuttlefish` copy — the same engine that builds it — and maps the results (pin capability errors, alias conflicts, peripheral ownership, and the rest of the validation suite) onto real editor ranges in the Problems panel. A status-bar item shows the board and error/warning counts. The generated `.typecad-hal/board.ts` also carries each pin's harvested facts as JSDoc (`/** PWM tim4 ch1 · aliases: D0 */`), bus instances carry their pinctrl pad routes (`/** Board-wired I2C bus 0 (SCL=PB8, SDA=PB9). */`), and the extension resolves your own bindings on hover — `const adc = new ADC(PA0)` reads "ADC — on PA0" with the pin's routes — so hover and completions are board-aware in plain TypeScript tooling too.

## Source maps for embedded

C++ compiler errors map back to your TypeScript source automatically: during `typecad-hal build --compile`, every parsed compiler diagnostic is reported at its TypeScript file, line, and column — not the generated C++.

## Dead code elimination

Tree-shaking is on by default. Only code reachable from your entry points (top-level statements → generated `main()`) makes it into the output. The transpiler reports what was removed.

---

## Quick start

Scaffold a new project in one command — no global install needed:

```bash
npx @typecad/cuttlefish create my-project --board esp32s3
cd my-project
npm install
```

This creates a complete project with `typecad-hal.config.ts`, `tsconfig.json`, a starter blink sketch, and all the right dependencies. Available boards: any Zephyr board variant in the data pack (`esp32s3`, `xiao_ble`, `blackpill_f411ce`, `rpi_pico`, …). Custom-PCB hardware uses a contract project — set `soc:` + `contract:` in `typecad-hal.config.ts` instead of `board:`.

Or launch an interactive wizard:

```bash
npx @typecad/cuttlefish create
```

### Manual setup

```bash
npm install @typecad/hal @typecad/framework-zephyr
```

Create `typecad-hal.config.ts`:

```typescript
import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry:     './src/main.ts',
  board:     'xiao_ble/nrf52840',
  framework: '@typecad/framework-zephyr',
  output:    { outDir: './out' },
};

export default config;
```

Write your sketch:

```typescript
import { LED } from '@typecad/board';
import { GPIO, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

while (true) {
  led.toggle();
  Time.sleep(1000);
}
```

Build and flash:

```bash
npx typecad-hal sketch.ts --compile --upload --port COM4
```

---

## CLI reference

```bash
npx @typecad/cuttlefish create [project-name] [options]   # scaffold a new project
typecad-hal create [project-name] [options]                # scaffold via the full CLI (after install)
typecad-hal <input.ts> [options]
typecad-hal build                                  # use entry from typecad-hal.config.ts
typecad-hal test [files...] [options]              # hardware tests (flashes tests/ + reports over serial)
typecad-hal preview [--config <path>] [--port <p>] # browser preview for a UI project
typecad-hal gen-decls <file.cpp|--all <dir>>       # .d.ts stubs from C++ headers
typecad-hal doctor                                 # check the active framework's environment
typecad-hal licenses [--all] [--strict]            # scan project libraries for SPDX licenses
typecad-hal sbom [--format cyclonedx|spdx] [flags] # build-true SBOM (CycloneDX 1.6 default; also stamped on every build)
typecad-hal audit [--strict] [--json]            # security baseline over the merged build config (waivers: .typecad-hal/audit-waivers.json)
typecad-hal trace capture [--port <p>] [--duration <s>] [--output <path>]
                                                   # record runtime-stats heartbeats from the board (needs zephyr.trace.enabled in the config)
typecad-hal trace report [--input <path>] [--json] [--gate <expr>...] # CPU load, stack high-water, UI frame/phase stats; --gate = CI regression gate (exit 1)
typecad-hal trace view [--input <path>] [--port <p>] # canvas timeline viewer (CPU lanes, UI frames, Trace.event markers)
typecad-hal board sync [zephyr-base]               # rebuild the board catalog from your Zephyr tree (after west update)
typecad-hal board regen                            # regenerate .typecad-hal/board.ts (also runs automatically on build)
typecad-hal library <search|install|init|validate> # library package manager
```

### Project scaffolding (`typecad-hal create`)

The scaffolding is built into the `typecad-hal` CLI — `npx @typecad/cuttlefish create` downloads the transpiler toolchain on demand and scaffolds a project without pulling in the full set of packages. Once installed in a project (or globally), the binary is just `typecad-hal`.

| Flag | Description |
|---|---|
| `[project-name]` | Project name (default: interactive prompt) |
| `--target, -t <id>` | Board target (qualified catalog id like `esp32s3_devkitc/esp32s3/procpu`; bare board names resolve too; `native` for a desktop project). Skips the interactive wizard. |
| `--board, -b <id>` | Alias for `--target`. |
| `--framework, -f <id>` | Framework. Default: `@typecad/framework-zephyr`. |
| `--probe, --flash <id>` | Probe/flash method (`stlink`, `dfu`, `jlink`, ...). |
| `--port, -p <port>` | Serial port the board is on (e.g. `COM4`, `/dev/ttyACM0`). |
| `--baud <rate>` | Serial baud rate (default: `115200` on Zephyr, `9600` otherwise). |
| `--no-starter` | Skip generating the starter program. |
| `--no-install` | Skip installing dependencies. |
| `--outDir, -o <dir>` | Output directory (default: `./<project-name>`). |

### Transpile options

| Flag | Default | Description |
|---|---|---|
| `--emit cpp\|split` | `split` | Output format for multi-file programs |
| `--target <platform>` | `generic` | Target platform string; the loaded framework registers its own target id |
| `--outDir <path>` | input directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.thcppmap.json` source map sidecars |

### Build chain (each flag requires the previous)

| Flag | Requires | Description |
|---|---|---|
| `--compile` | `west build` | Run the toolchain build after transpilation |
| `--upload` | `--compile`, `--port` | Upload compiled sketch to the board |
| `--monitor` | `--port` | Open serial monitor after upload |
| `--port <port>` | — | Serial port, e.g. `COM4` or `/dev/ttyACM0` |
| `--baud <rate>` | — | Baud rate for `--monitor` (default: `9600`) |

### Tree-shaking options

| Flag | Description |
|---|---|
| `--no-tree-shake` | Disable dead code elimination |
| `--keep-unused-enums` | Keep all enums even if unreferenced |
| `--keep-unused-classes` | Keep all classes even if uninstantiated |
| `--keep-unused-types` | Keep all type aliases even if unused |
| `--keep-unused-variables` | Keep all top-level variables even if unreferenced |
| `--entry-point <name>` | Add a custom entry point (repeatable) |

---

## Monorepo scripts

| Script | Description |
|---|---|
| `npm run build` | Build all packages |
| `npm run typecheck` | Type-check all packages (`tsc -b`) |
| `npm test` | Run all tests (Vitest) |
| `npm run ci` | Run tests then build all packages |

### Version management (Changesets)

All packages share a fixed version via [Changesets](https://github.com/changesets/changesets).

1. **Create a changeset** — run after making changes:
   ```bash
   npm run changeset
   ```
   Select which packages changed and the bump type (`patch` / `minor` / `major`). This creates a file in `.changeset/` describing the change.

2. **Bump versions** — before publishing, consume all pending changesets:
   ```bash
   npm run version
   ```
   This bumps `package.json` versions, updates internal dependency ranges, and generates changelogs. With fixed versioning, all packages get the same version number.

3. **Publish** — push packages to the registry:
   ```bash
   npx changeset publish
   ```
   Publishes the versioned workspace packages to npm.

---

## Documentation

- [Runtime exception behavior](RUNTIME_EXCEPTION.md)
- [Framework authoring guide](docs/framework-authoring-guide.md)
- [Framework coverage matrix](docs/framework-coverage.md) — generated by
  `npm run render:framework-coverage`
- [Framework manifest error codes](docs/framework-manifest-error-codes.md)
- [HAL design notes](docs/hal/) — per-peripheral API references
- [Ownership model](docs/ownership/) — `owned` / `shared` / `mut` semantics

## License

Apache-2.0 — see [LICENSE](./LICENSE). Generated output carries the
[TypeCAD Runtime Exception](./RUNTIME_EXCEPTION.md); bundled third-party
attributions are in [NOTICE](./NOTICE).
