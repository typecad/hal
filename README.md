TypeHAL<

- Write firmware in TypeScript. Ship it as C++.
- Type-safe, board-aware embedded development that catches hardware bugs before you flash — not after a 30-second upload cycle.


---

## Why TypeHAL?

Embedded firmware development has a feedback loop problem. You write C++, flash it to a board, and *then* discover you passed the wrong pin, forgot to initialize a bus, or used a pin that's already claimed by I2C. Every mistake costs a compile-flash-test cycle.

TypeHAL moves those checks into your editor. You write TypeScript against typed hardware abstractions that know which pins support PWM, which pins are shared with SPI, and whether your I2C bus was initialized before you tried to read from it. If something's wrong, you see the red squiggle immediately — not a blank serial monitor thirty seconds later.

```typescript
import { LED, delay } from '@typehal';

const led = LED.asOutput();

while (true) {
  led.toggle();
  delay(1000);
}
```

That's a complete Arduino sketch. `LED.asOutput()` configures the pin mode and returns a type-narrowed handle. The transpiler emits `pinMode(13, OUTPUT)` and `digitalWrite(13, !digitalRead(13))` — no extra variables, no overhead.

## Catch hardware mistakes in your editor

Every pin has a narrow type that reflects what it can actually do on your board.

```typescript
import { D4, D9, A0 } from '@typehal';

D4.pwm(50);    // Error: D4 does not support PWM on Arduino Uno
D9.pwm(50);    // OK — D9 is a PWM pin

A0.high();     // Error: A0 is analog-only
A0.readAnalog(); // OK
```

The transpiler also detects conflicts between peripherals and GPIO:

```typescript
import { I2C0, A4 } from '@typehal';

I2C0.begin();
A4.output(HIGH); // Warning: A4 is claimed by I2C0
```

These are not linter hints. They're type errors and transpiler diagnostics rooted in your board's actual pinmux.

## Peripherals with state

Calling `.device()` on an uninitialized bus is a compile-time error.

```typescript
import { I2C0 } from '@typehal';

I2C0.device(0x76).readByte(0xFA); // Error: I2C0 has not been initialized
```

```typescript
import { I2C0 } from '@typehal';

I2C0.begin();
const who = I2C0.device(0x76).readByte(0xFA); // OK
```

SPI and UART follow the same pattern — the type system tracks initialization state so you can't forget `.begin()`.

## One command to flash

```bash
npx typehal sketch.ts --compile --upload --monitor --port COM4
```

Transpile, compile, upload, and open a serial monitor in a single invocation. Or use the individual flags — `--compile` only, `--compile --upload` only — whatever fits your workflow.

## Supported boards

| Board | Package | Architecture |
|---|---|---|
| Arduino Uno | `@typehal/board-arduino-uno` | AVR |
| Arduino Nano 33 IoT | `@typehal/board-arduino-nano33iot` | SAMD |
| ESP32 DevKit | `@typehal/board-esp32-devkit` | ESP32 |
| ESP32-S3 | `@typecad/board-esp32s3` | ESP32-S3 (Xtensa LX7) |
| ESP32-C3 | `@typecad/board-esp32c3` | ESP32-C3 (RISC-V) |
| ESP32-C6 | `@typecad/board-esp32c6` | ESP32-C6 (RISC-V, Wi-Fi 6) |

Additional architectures are scaffolded and ready for board definitions: ESP32-S2, ESP32-S3, ESP32-C3, RP2040, STM32, nRF52.

## Configure once

```typescript
// typehal.config.ts
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board:  '@typehal/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

The transpiler auto-generates `typehal-env.d.ts` so your editor resolves the `@typehal` virtual import with full IntelliSense — no `tsconfig.json` changes needed.

## Zero-cost abstractions

TypeScript constructs that have no C++ equivalent are erased or inlined at transpile time:

- GPIO aliases (`const led = LED.asOutput()`) produce no C++ variables
- `Shared<T>` phantom types emit C++ `const`
- `Owned<T>` / `Mutable<T>` types are fully erased
- Enums, classes with private fields, destructuring, template literals, typed arrays — all lowered to valid C++ for an ATmega328P with 2KB RAM

## Rust-inspired bus ownership

```typescript
import { I2C0 } from '@typehal';

const bus = I2C0.take(); // exclusive claim

bus.device(0x76).readByte(0xFA);

bus.release(); // return to pool
```

On single-threaded Arduino, `take`/`release` are emitted as comments. On multi-threaded platforms like ESP32, they map to mutex acquisition. In both cases the transpiler validates correct usage — double-take and use-without-own are errors.

## Test on real hardware

```typescript
import { describe, it, expect } from '@typehal/expect';
import { A0 } from '@typehal';

describe('Analog input').it('reads within valid range', () => {
  expect(A0.readAnalog()).toBeWithinRange(0, 1023);
});
```

These tests run on the actual microcontroller over serial. The host-side runner reports pass/fail from real pin states and sensor readings — not mocks.

## Simulate without hardware

The in-memory simulator lets you develop and test firmware logic in Node.js before touching a board:

```typescript
import { createSimBoard } from '@typehal/simulator';

const board = createSimBoard();
// Mock I2C devices, inject serial data, verify bus traffic
```

Register simulated I2C/SPI devices, inject data, and assert on operation logs — all without a physical board connected.

## Build hardware UIs with HTML + CSS

TypeHAL includes a compile-time UI framework: write HTML and CSS, and the transpiler generates C++ that renders directly on SPI TFT displays (ILI9341, ST7796S), OLED, and e-ink panels. No browser, no runtime interpreter — the markup compiles to the same retained-mode node tables and draw dispatch as hand-written display code.

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

The transpiler splits the `.ui` file into its three streams and feeds them through the existing HTML/CSS/TS pipelines. Set `entry: './src/app.ui'` in your config. The VS Code Svelte extension provides syntax highlighting and linting for `.ui` files.

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
- Box model (width, height, padding, margin, border, border-radius, box-sizing)
- Typography (font-size, font-weight, font-style, line-height, letter-spacing, text-align, text-decoration, text-overflow, white-space)
- Colors (hex, rgb(), hsl(), named colors, CSS variables, `var()` with theme classes)
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

## Debug in VS Code

Set breakpoints in your `.ts` source files. The transpiler injects serial instrumentation that reports variable values and lets you step through execution — directly from your TypeScript code.

## Source maps for embedded

C++ compiler errors map back to your TypeScript source:

```bash
npx typehal map-error out/sketch/sketch.ino.thcppmap.json --line 42 --column 5
```

You see the TypeScript file, line, and column — not the generated C++.

## Dead code elimination

Tree-shaking is on by default. Only code reachable from your entry points (`setup`/`loop` for Arduino, `main` for generic) makes it into the output. The transpiler reports what was removed.

---

## Quick start

Scaffold a new project in one command — no global install needed:

```bash
npx @typehal/create my-project --board arduino-uno
cd my-project
npm install
```

This creates a complete project with `typehal.config.ts`, `tsconfig.json`, a starter blink sketch, and all the right dependencies. Available boards: `arduino-uno`, `esp32-devkit`, `esp32s3`, `esp32c3`, `esp32c6`.

Or launch an interactive wizard:

```bash
npx @typehal/create
```

### Manual setup

```bash
npm install typehal @typehal/board-arduino-uno
```

Create `typehal.config.ts`:

```typescript
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board:  '@typehal/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

Write your sketch:

```typescript
import { LED, delay } from '@typehal';

const led = LED.asOutput();

while (true) {
  led.toggle();
  delay(1000);
}
```

Build and flash:

```bash
npx typehal sketch.ts --compile --upload --port COM4
```

---

## CLI reference

```bash
npx @typehal/create [project-name] [options]   # scaffold a new project
typehal init [project-name] [options]           # scaffold via the full CLI
typehal <input.ts> [options]
typehal build                                  # use entry from typehal.config.ts
typehal gen-libdefs <input.ts>
typehal map-error <mapFile> [options]
typehal create-board <name>                    # scaffold a new board package
```

### Project scaffolding (`@typehal/create`)

The `@typehal/create` package is standalone — it only depends on `chalk` and Node built-ins, so `npx` downloads it instantly without pulling in the transpiler toolchain.

| Flag | Description |
|---|---|
| `[project-name]` | Project name (default: interactive prompt) |
| `--board, -b <id>` | Board to target (`arduino-uno`, `esp32-devkit`). Skips interactive wizard. |
| `--framework, -f <id>` | Framework (`arduino`, `avr`). Default: `arduino`. |
| `--baud <rate>` | Serial baud rate (default: `9600`). |
| `--no-sketch` | Skip generating the starter blink sketch. |
| `--outDir, -o <dir>` | Output directory (default: `./<project-name>`). |
| `--help, -h` | Show help. |

The `typehal init` command delegates to `@typehal/create` and accepts the same flags.

### Transpile options

| Flag | Default | Description |
|---|---|---|
| `--emit cpp\|split` | `split` | Output format; Arduino target always emits `.ino` |
| `--target arduino\|generic` | `generic` | Auto-set to `arduino` when `--compile`, `--upload`, or `--monitor` is used |
| `--outDir <path>` | input directory | Output directory for generated files |
| `--emit-maps true\|false` | `true` | Write `.thcppmap.json` source map sidecars |
| `--fqbn <package:arch:board>` | *(from config)* | FQBN override; required for `--compile` when no config exists |

### Build chain (each flag requires the previous)

| Flag | Requires | Description |
|---|---|---|
| `--compile` | `fqbn` | Run `arduino-cli compile` after transpilation |
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
| `--no-report-unused` | Suppress diagnostics for removed code |
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
   npm run publish:all
   ```
   Publishes `core`, `hal`, `cli`, `create`, and `expect` in dependency order to npm. Individual packages can be published with `npm run publish:core`, `npm run publish:cli`, `npm run publish:create`, etc. For a private registry, use `npm run publish:private`.
