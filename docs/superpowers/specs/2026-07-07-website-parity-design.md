# Website Parity: Cuttlefish Rebrand + `@typecad/ui` and `@typecad/expect` Docs

**Date:** 2026-07-07
**Status:** Approved (pending spec review)
**Branch:** `render-parity`

## Problem

The marketing site at `website/` is stale relative to the workspace in three
compounding ways:

1. **Rebrand not reflected.** The workspace renamed its firmware product from
   **typeHAL** (`@typehal/*` packages, `typehal` CLI, `typehal.config.ts`,
   `.typehal/`) to **Cuttlefish** (`@typecad/cuttlefish` package, `cuttlefish`
   CLI, `cuttlefish.config.ts`, `.cuttlefish/`) in commit `2393577`
   "major refactor" (2026-06-06), folding the old `@typehal/core`,
   `@typehal/transpiler`, `@typehal/create`, and `@typehal/schema` packages into
   `@typecad/cuttlefish`. The site still uses the old names everywhere:
   `siteConfig.name = "typeHAL"`, the home-page hero is `typeHAL`, and every
   docs page uses `@typehal/*` imports, the `typehal` CLI, and the dead
   `typehal build --expect` flag.

2. **`@typecad/ui` is undocumented on the site.** A mature HTML/CSS-driven UI
   authoring library for microcontrollers (12 elements, a `.ui` single-file
   format, a full CSS engine, display adapters for ILI9341/SSD1309/ST7796/
   SSD1680/SDL) ships in the workspace with no corresponding `docs/ui/`
   section.

3. **`@typecad/expect` docs are wrong.** The testing pages reference the old
   `@typehal/expect` package and a `typehal build --compile --upload --expect`
   invocation that no longer exists. The current package is
   `@typecad/expect` with its own dedicated `cuttlefish-test` binary and a
   vitest-style assertion API.

Additional drift found during exploration:

- `docs/ecosystem/+page.md`'s package table lists four **deleted** packages
  (`@typehal/core`, `@typehal/transpiler`, `@typehal/create`, `@typehal/schema`)
  and omits seven **current** packages (`@typecad/ui`, `@typecad/expect`,
  `@typecad/mcu-atmega328p`, `@typecad/mcu-esp32`, `@typecad/mcu-esp32s3`,
  `@typecad/board-esp32s3`, and the framework/board packages are mis-scoped).
  It also shows a `defineConfig` import from `@typehal/core` — that helper no
  longer exists; configs now use `import type { CuttlefishConfig } from
  '@typecad/cuttlefish/api'` with a plain typed `const config`.
- `docs/ecosystem/+page.md`'s Quick Start shows `npx @typehal/create my-project`
  — the scaffolder is now the `cuttlefish create` subcommand
  (`npx cuttlefish create my-project --target arduino-uno`).
- The config-file *shape* changed: configs now have separate `mcu` and `board`
  fields plus `frameworkData.buildTarget` and `output.framework`, not the old
  `target`/`board`/`framework`/`toolchain` shape shown on the site.
- `packages/cuttlefish/README.md` itself is stale (`npx typehal`), but fixing
  package READMEs is **out of scope** for this website pass — flagging only.

## Decisions (locked with user)

- **Brand:** typeCAD remains the umbrella brand (PCB-in-code, domain
  `typecad.net`). The firmware transpiler product is renamed **Cuttlefish**
  everywhere on the site.
- **Scope:** Full parity — rebrand + new UI section + expect rewrite + ecosystem
  restructure + stale-flag sweeps across the site.
- **UI docs depth:** Multi-page section under `docs/ui/`.
- **Expect docs location:** Under the existing `docs/testing/` section (rewrite
  + new `expect/` page), not a new top-level section.
- **`llms/` mirror and `static/llms.txt`:** Explicitly **out of scope** for this
  pass (deferred to a separate task).
- **Home page:** Hero becomes **Cuttlefish** (mechanical swap + minimal hero
  reframe; typeCAD stays the site/SEO brand).
- **Execution:** Phased by concern — three sequential, independently-reviewable
  commits.

## Naming Canon (applied everywhere)

| Concept | Old | New |
|---|---|---|
| Firmware product name | typeHAL | **Cuttlefish** |
| npm scope | `@typehal/*` | `@typecad/*` |
| Transpiler package | `@typehal/transpiler` (+ core/schema/create) | `@typecad/cuttlefish` |
| CLI binary | `typehal` | `cuttlefish` |
| Test binary | (none — was a `--expect` flag) | `cuttlefish-test` |
| Config file | `typehal.config.ts` | `cuttlefish.config.ts` |
| Cache/config dir | `.typehal/` | `.cuttlefish/` |
| Scaffolder | `npx @typehal/create` | `cuttlefish create` (subcommand) |
| Source-map suffix | `.thcppmap.json` | **unchanged** (`.thcppmap.json`) |
| Umbrella brand | typeCAD | **unchanged** (typeCAD, `typecad.net`) |

Note: the `.thcppmap.json` suffix was kept as-is through the rebrand (verified
in `packages/cuttlefish/src/mapping/source-map.ts`). Only prose references like
"TypeHAL source map" need rewording; the file extension itself stays.

## Architecture of the Change

The site is a SvelteKit + mdsvex app. All docs content is Markdown (`+page.md`).
A single `website/src/routes/docs/+layout.svelte` renders every docs route and
pulls sidebar navigation from `docsConfig` in
`website/src/lib/config/docs.ts`. Therefore:

- Adding a docs section = new `+page.md` files + one entry in `docsConfig.docsNav`.
- No per-section `+layout.svelte` files are needed (there is only the one
  shared docs layout).
- The right-side `TableOfContents` is auto-generated from page headings.

This keeps the change surface small: content edits to Markdown, plus targeted
edits to two TypeScript config files (`site.ts`, `docs.ts`) and one Svelte
component (`+page.svelte`).

## Phase 1 — Mechanical Rebrand Sweep

**One commit. Pure find/replace + targeted prose fixes. No new content.
Reviewable as a single diff.**

### 1.1 Global config / home page

- `website/src/lib/config/site.ts`:
  - `name: "typeHAL"` → `"Cuttlefish"`
  - `description`: replace "typeHAL" framing with "Cuttlefish — TypeScript to
    C++ transpiler for embedded firmware"
  - `keywords`: replace the `typeHAL` token with `cuttlefish`; keep
    `TypeScript,embedded,C++,transpiler,HAL,Arduino,ESP32,firmware,microcontroller`
- `website/src/routes/+page.svelte` (home):
  - `<PageHeader.Heading>typeHAL</…>` → `Cuttlefish`
  - Tagline `TypeScript + Embedded Safety = typeHAL` → `= Cuttlefish`
  - Hero narrative reframed to lead with Cuttlefish as the firmware product
    under the typeCAD umbrella. (Minimal prose change; do not restructure the
    benefit-card grid.)
  - Update `title`/`description` constants if they reference typeHAL.

### 1.2 Content sweep

Case- and boundary-aware string replacement across all `docs/**/*.md`,
top-level route `*.md` pages (`getting-started`, `code`, `git`, `automate`,
`package`, `packages`), and `docs/+page.md`. News posts handled per §1.4.

| Find | Replace | Notes |
|---|---|---|
| `@typehal/transpiler` | `@typecad/cuttlefish` | |
| `@typehal/core` | `@typecad/cuttlefish` | core was folded into cuttlefish |
| `@typehal/create` | (remove / rewrite) | see §3.2, scaffolder is now a subcommand |
| `@typehal/schema` | `@typecad/cuttlefish` | schema was folded into cuttlefish |
| `@typehal/hal` | `@typecad/hal` | |
| `@typehal/board-*` | `@typecad/board-*` | |
| `@typehal/framework-*` | `@typecad/framework-*` | |
| `@typehal/mcu-*` | `@typecad/mcu-*` | (often missing from pages — add where relevant) |
| `@typehal/expect` | `@typecad/expect` | |
| `@typehal/simulator` | `@typecad/simulator` | |
| `@typehal/ui` | `@typecad/ui` | (rare; ui is mostly undocumented) |
| `typehal build` | `cuttlefish build` | |
| `typehal <other-cmd>` | `cuttlefish <other-cmd>` | |
| `npx typehal` | `npx cuttlefish` | |
| `typehal.config.ts` | `cuttlefish.config.ts` | |
| `.typehal/` | `.cuttlefish/` | |
| `TypeHAL` (prose) | `Cuttlefish` | |
| `--expect` CLI flag | (remove) | replaced by dedicated `cuttlefish-test` binary |
| `defineConfig` (from `@typehal/core`) | `import type { CuttlefishConfig } from '@typecad/cuttlefish/api'` | see §3.3 for new config shape |

### 1.3 Files in scope

All 24 files under `website/src/routes/docs/`, the 6 top-level `*.md` pages,
`site.ts`, and `+page.svelte`. **`llms/` and `static/` are untouched.**

### 1.4 News posts

News posts are dated artifacts. Decision: **apply only the CLI/binary and
package-scope swaps from §1.2 inside news posts** (`typehal` → `cuttlefish`,
`@typehal/*` → `@typecad/*`, `typehal.config.ts` → `cuttlefish.config.ts`) so
any instructions they contain at least reference the right binary, but
**leave narrative/product-framing prose intact** — do **not** rewrite
"TypeHAL"/"typeHAL" as a product name inside news bodies (a 2025 post saying
"we launched typeHAL" stays historically accurate). If a post's body contains
a now-wrong instruction that can't be fixed by a CLI/package swap alone (e.g.
the dead `--expect` flag), leave the body and let the dedicated expect docs
page be the source of truth. The split: tokens that are *commands/imports*
get swapped; tokens that are *prose product names* stay.

### 1.5 Self-check

After Phase 1, `grep -ri "typehal" website/src/routes website/src/lib` returns
zero hits except deliberate historical mentions in `news/` body prose.

## Phase 2 — New `docs/ui/` Multi-Page Section

**One commit. Five new `+page.md` files + sidebar wiring.**

### 2.1 Pages (under `website/src/routes/docs/ui/`)

1. **`docs/ui/+page.md`** (section index) — What is Cuttlefish UI; the
   HTML/CSS-for-microcontrollers model; retained-mode runtime, transpile-time
   resolution (no browser/DOM/CSS engine on device); a first example
   (`<screen>` with a `<text>` and `<button>`); the `.ui` single-file format
   in one paragraph; links out to the four topic pages. Mirrors the
   structure of `docs/transpiler/+page.md` and `docs/hal/+page.md` (heading,
   `---`, overview table, short examples, "see X for detail").
2. **`docs/ui/elements`** — Full element catalog with one short example each:
   `<screen>` (root, exactly one), `<view>` (container, flex), `<text>`,
   `<button>` (with `:pressed`), `<check>`, `<radio name="g">`,
   `<select>` + `<option>`, `<progress>`, `<range min max>`, `<input>`
   (on-screen keyboard), `<list item-height>`, `<canvas width height>`,
   `<img src width height>` (raw RGB565 `.img`). Tag aliases (`body/div/header/
   footer/nav/main/section/article/aside` → `<view>`; `span/p/h1-h6` →
   `<text>`). The global `hidden` attribute.
3. **`docs/ui/css`** — CSS reference: box model & length units
   (`px`/`rem`/`em`/`calc()`/`var()`), Yoga flexbox, color formats,
   typography (`@font-face`, font subsetting `exact`/`fallback`, smoothing),
   visual properties, transitions and `:pressed`, the selector grammar
   (element/id/class/compound/descendant/child/sibling/attribute/`:not()`/
   pseudo-state), CSS variables + class-scoped themes, compile-time `@media`
   variant selection.
4. **`docs/ui/display-config`** — Wiring & display configuration: the
   `display` section of `cuttlefish.config.ts` (`profile`, `driver`, `width`,
   `height`, `colorFormat` (`"rgb565" | "mono"`), `rotation`, `backlight`,
   `cs`/`dc`/`rst`, `antialias`, `themeCss`, `themeClass`); built-in profiles
   (`ili9341-spi` 320×240 RGB565, `ssd1309-i2c` 128×64 mono); supported
   drivers (`ili9341`, `st7796`, `ssd1680` e-ink mono, `ssd1309`, `sdl`);
   touch config (`XPT2046_Touchscreen` / `Adafruit_TouchScreen` /
   `Adafruit_STMPE610` / custom adapter with calibration); the display-adapter
   extension API (`registerDisplayAdapter`, `DisplayProfile`,
   `DisplayAdapterCode`).
5. **`docs/ui/api`** — Authoring API reference: `ui.mount(tree, opts?)` with
   `MountOptions`; `ui.signal(initial)` (three overloads) and `Signal<T>`
   (`()` read, `.set()` write); `ui.bind(node, property, compute)`;
   `ui.bindInput(node, onText)`; `ui.bindList(node, countFn, itemFn, onTap?)`;
   `ui.watchPin(pin, onFalling)`; `ui.onTap(node?)`; `ui.drawCanvas(node,
   callback)` with the full `CanvasCtx` (`width`, `height`, `drawPixel`,
   `fillRect`, `rect`, `fillRoundRect`, `roundRect`, `line`, `hline`,
   `vline`, `fillCircle`, `circle`, `rgbBitmap`, `text`, `fillScreen`);
   `ui.window.setTitle(title)` / `ui.window.setIcon(path)` (native SDL only).
   Then the `.ui` single-file format (script/style/template sections,
   accepted entry extensions `.ts`/`.tsx`/`.ui`, two project layouts:
   single-file `.ui` vs `main.ts` + `.ui.html` split) and the reactive/state
   model (`.value` read/write, `onToggle`/`onChange`, touch events with
   50 ms debounce / 600 ms hold, signals, timers).

### 2.2 Sidebar wiring

Add one top-level group to `docsConfig.docsNav` in
`website/src/lib/config/docs.ts`, positioned after "Transpiler & Language
Engine" and before "Hardware Simulation":

```ts
{
  title: "User Interface (Cuttlefish UI)",
  href: "/docs/ui",
  items: [
    { title: "Elements",            href: "/docs/ui/elements",       items: [] },
    { title: "CSS & Styling",       href: "/docs/ui/css",            items: [] },
    { title: "Display Configuration", href: "/docs/ui/display-config", items: [] },
    { title: "Authoring API",       href: "/docs/ui/api",            items: [] },
  ],
},
```

### 2.3 Source of truth for content

- Element list, CSS capabilities, display config: `packages/ui/README.md` and
  `packages/ui/src/types.ts` (authoritative public types).
- `cuttlefish.config.ts` display fields: `demo-ui-sd13/cuttlefish.config.ts`
  and `demo-st/cuttlefish.config.ts` (real, current examples — copy wiring
  snippets from these, not from stale docs).
- API surface: `packages/ui/src/index.ts` (the `ui.*` authoring functions).

## Phase 3 — Expect Docs Rewrite + Ecosystem Restructure

**One commit. Two sub-parts.**

### 3.1 `docs/testing/` rewrite (expect under testing/)

- **`docs/testing/+page.md`** — Replace the `@typehal/expect` quick example
  with `@typecad/expect`; replace
  `typehal build --compile --upload --expect --port COM4` with
  `cuttlefish-test --port COM4` (the dedicated binary); update the workflow
  bullets to reference the new flow (write test → `cuttlefish-test` →
  results over serial). Keep the two-approaches framing
  (HIL + source-mapped diagnostics).
- **`docs/testing/hil/+page.md`** — Rewrite to the current
  `@typecad/expect` API: `describe`/`it`/`done`, `expect()` numeric matchers
  (10: `toBe`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`,
  `toBeLessThanOrEqual`, `toBeCloseTo(n, precision)`, `toBeWithinRange(min,
  max)`, `toBeTruthy`, `toBeFalsy`, `toNotBe`), `expectString()` string
  matchers (4: `toBe`, `toContain`, `toHaveLength`, `toNotBe`), the
  `cuttlefish-test` CLI (flags `-p/--port`, `-b/--board`, `--build-target`,
  `--baud`, `-t/--timeout`, `-i/--include`, `-x/--exclude`, `-v/--verbose`,
  `-h/--help`), the serial protocol tags (`[TC:SUITE_START]`,
  [TC:DESCRIBE:name]`, etc.), and the per-target skip/only directives
  (`// @typecad-skip-target esp32:`, `// @typecad-only-target avr,megaavr:`).
- **`docs/testing/expect/+page.md`** (new) — Dedicated assertion API +
  config reference: the `test` section of `cuttlefish.config.ts`
  (`TestConfig`: `include`, `exclude?`, `port`, `baudRate`, `timeout`,
  `serialOpenDelay?`, `resetAfterOpen?`, `buildTarget?`, `board?`,
  `verbose?`), worked examples drawn from
  `examples/09-expect-demo.test.ts` and
  `examples/24-uno-validation.test.ts`.
- **`docs/testing/source-mapped-diagnostics/+page.md`** — Largely intact;
  sweep names (`typehal` → `cuttlefish`). The source-map *concept* and the
  `.thcppmap.json` suffix are unchanged. Replace any `typehal build
  --diagnostics` with `cuttlefish build --diagnostics`.
- Add `expect` to the `docs/testing` sidebar group in `docs.ts`:

```ts
{ title: "Testing & Diagnostics", href: "/docs/testing", items: [
  { title: "Hardware-in-the-Loop (HIL)", href: "/docs/testing/hil", items: [] },
  { title: "Expect Assertion API",       href: "/docs/testing/expect", items: [] },
  { title: "Source-Mapped Diagnostics",  href: "/docs/testing/source-mapped-diagnostics", items: [] },
]},
```

### 3.2 `docs/ecosystem/+page.md` restructure

This page can't be merely renamed — it lists four deleted packages. Restructure
the "Package Ecosystem" table to match the **actual current 14 packages**:

| Package | Purpose |
|---|---|
| `@typecad/cuttlefish` | TypeScript-to-C++ transpiler — native, Arduino, and bare-metal targets (includes the former core, schema, and create packages) |
| `@typecad/hal` | Hardware Abstraction Layer — user-facing API surface |
| `@typecad/ui` | HTML/CSS-driven UI authoring library for microcontrollers |
| `@typecad/expect` | Hardware test framework — vitest-style assertions over serial |
| `@typecad/simulator` | Hardware simulation runtime for Node.js |
| `@typecad/mcu-atmega328p` | MCU definition for ATmega328P |
| `@typecad/mcu-esp32` | MCU definition for ESP32 |
| `@typecad/mcu-esp32s3` | MCU definition for ESP32-S3 |
| `@typecad/framework-avr` | AVR native register-level code generation |
| `@typecad/framework-arduino` | Arduino framework code generation |
| `@typecad/framework-native` | Native C++ for desktop builds (g++/clang++) |
| `@typecad/board-arduino-uno` | Board definition for Arduino Uno Rev3 |
| `@typecad/board-esp32-devkit` | Board definition for ESP32 DevKit v1 |
| `@typecad/board-esp32s3` | Board definition for ESP32-S3 |

Also fix the Quick Start scaffolding block:

```bash
npx cuttlefish create my-project --target arduino-uno
cd my-project
npm install
npm run compile
```

### 3.3 Config-file example (corrected shape)

Replace the old `defineConfig` example with the current typed-const pattern,
copied from `demo-ui-sd13/cuttlefish.config.ts` (a known-current real config):

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/sketch.ts',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

### 3.4 CLI reference page

`docs/ecosystem/cli-reference/+page.md` — replace the `typehal` reference
with the **actual** `cuttlefish` command surface (verified from
`packages/cuttlefish/src/cli.ts`):

- `cuttlefish create [name] [options]` — scaffold a new project (targets:
  `arduino-uno`, `esp32`, `esp32s3`, `native`, …)
- `cuttlefish build` — transpile (+ `--compile`, `--upload`, `--monitor`,
  `--port`, `--baud`, `--watch`, `--diagnostics`)
- `cuttlefish preview` — local preview server
- `cuttlefish map-error` — map a C++ error location back to TypeScript
- `cuttlefish gen-decls` — generate TypeScript declarations from C++ headers
- `cuttlefish gen-libdefs` — generate library definitions

Drop the dead `--expect` flag entirely; point to the separate
`cuttlefish-test` binary for hardware tests with a one-line cross-reference
to `docs/testing/expect`.

## Verification

Per `AGENTS.md` verification discipline and the site's own tooling:

1. **`npm run check --workspace website`** (svelte-check) — must pass; catches
   broken markdown and TypeScript errors in config.
2. **`npm run build --workspace website`** (the site's build script) — must
   succeed; confirms mdsvex compiles every new `.md` page and no route 404s.
3. **Structural grep:** `grep -ri "typehal" website/src/routes website/src/lib`
   returns zero hits except deliberate historical mentions in `news/` body
   prose (Phase 1.5 self-check).
4. **Link audit:** spot-check that every internal doc link resolves —
   specifically the new `docs/ui/*` and `docs/testing/expect` pages linked
   from sidebars and section indexes, and that `docs/ecosystem/+page.md`
   links still resolve after restructure.

There is no test framework for the site beyond svelte-check + build; these are
the authoritative gates. Each phase commit must pass both before moving on.

## Out of Scope

- `website/llms/` mirror and `static/llms.txt` / `llms-full.txt` regeneration
  (deferred per user decision).
- Package READMEs (e.g. `packages/cuttlefish/README.md` is also stale at
  `npx typehal`) — flagging only, not fixing in this pass.
- The `vscode-typehal-debug/` extension and other non-website surfaces.
- GitHub repo URL, the typeCAD domain, and the typeCAD-as-PCB-brand framing.
- News post narrative rewriting beyond mechanical name-swaps.

## Risks & Mitigations

- **Risk:** Boundary-unaware replace corrupts identifiers (e.g. a hypothetical
  `typehalfoo`). **Mitigation:** use word-boundary regex; review every
  `@typehal/*` replacement individually since those are the highest-risk.
- **Risk:** Config examples drift again. **Mitigation:** copy from real
  current demo configs (`demo-ui-sd13/cuttlefish.config.ts`), not from
  memory or the stale docs.
- **Risk:** Phase ordering wastes work if the brand framing is wrong.
  **Mitigation:** brand was locked with the user before this spec; Phase 1
  is the smallest unit to course-correct if needed.
- **Risk:** New UI docs duplicate the `@typecad/ui` README and drift.
  **Mitigation:** UI section is a structured reference (elements/css/config/api
  split), not a README mirror; content is reorganized for web navigation.
