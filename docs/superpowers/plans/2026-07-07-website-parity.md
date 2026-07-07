# Website Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `website/` to parity with the renamed `@typecad/cuttlefish` transpiler and the added `@typecad/ui` and `@typecad/expect` features — rebrand typeHAL→Cuttlefish, add a new `docs/ui/` multi-page section, rewrite the expect/testing docs, and restructure the ecosystem page.

**Architecture:** The site is a SvelteKit + mdsvex app; all docs content is Markdown (`+page.md`). A single `docs/+layout.svelte` renders every docs route, pulling sidebar nav from `docsConfig` in `website/src/lib/config/docs.ts`. So changes are: content edits to Markdown, plus targeted edits to two TypeScript config files (`site.ts`, `docs.ts`) and one Svelte component (`+page.svelte`). No new layouts or routes-beyond-`+page.md` are needed. Execution is **phased by concern** — three commits, each independently reviewable and each passing `npm run check` + `npm run build` before moving on.

**Tech Stack:** SvelteKit 2, Svelte 5, mdsvex 0.12, Tailwind 4, svelte-check.

**Spec:** `docs/superpowers/specs/2026-07-07-website-parity-design.md`

---

## Critical context for the implementer (read before any edit)

This is a **content migration**, not feature code. There is no unit-test framework for the site. The verification gates are:
1. `npm run check --workspace website` (svelte-check) — must pass.
2. `npm run build --workspace website` — must succeed (confirms every `.md` compiles and no route 404s).
3. `grep -ri "typehal" website/src/routes website/src/lib` — returns zero hits except deliberate historical mentions in `website/src/routes/news/` body prose.

Run all three after each phase commit. The exact grep commands are given in each phase's final task.

### Naming canon (apply everywhere)

| Concept | Old | New |
|---|---|---|
| Firmware product name (prose) | typeHAL / TypeHAL | **Cuttlefish** |
| npm scope | `@typehal/*` | `@typecad/*` |
| Transpiler package | `@typehal/transpiler` (+core/schema/create) | `@typecad/cuttlefish` |
| CLI binary | `typehal` | `cuttlefish` |
| Test binary | (none — was `--expect` flag) | `cuttlefish-test` |
| Config file | `typehal.config.ts` | `cuttlefish.config.ts` |
| Cache/config dir | `.typehal/`, `.typehal-cache.json` | `.cuttlefish/`, `.cuttlefish-cache.json` |
| Generated ambient types file | `typehal-env.d.ts` | `cuttlefish-env.d.ts` |
| Config TS type | `TypehalConfig` (from `@typehal/core`) | `CuttlefishConfig` (from `@typecad/cuttlefish/api`) |
| Config helper | `defineConfig(...)` (from `@typehal/core`) | **removed** — use `const config: CuttlefishConfig = {...}; export default config;` |
| MCU manifest export | `typehalManifest` | `TypeCADManifest` |
| Emitted nullish helper | `typehal_nullish` / `typehal_n` | `cuttlefish_n` |
| Emitted exists guard | `typehal_exists` | `cuttlefish_exists` *(verify exact name when you reach that task)* |
| Emitted halt | `typehal_halt` | `cuttlefish_halt` *(verify exact name when you reach that task)* |
| Undefined sentinel | `TYPEHAL_UNDEFINED` | `CUTTLEFISH_UNDEFINED` |
| String temp var | `__typehal_str_N` | `__tc_str_N` *(verify exact name when you reach that task)* |
| Source-map suffix | `.thcppmap.json` | **unchanged** (`.thcppmap.json`) |
| Scaffolder invocation | `npx @typehal/create …` / `typehal init …` | `cuttlefish create …` (subcommand of `cuttlefish`) |
| Umbrella brand | typeCAD | **unchanged** (typeCAD, `typecad.net`) |

**On "verify exact name" entries:** the emitted C++ identifiers were heavily rewritten during the rebrand — the runtime now uses an `n_` prefix scheme (e.g. `n_StaticArray`, `n_entrypoint__`, `n_nptr` seen in `statement-renderer.ts`), `CUTTLEFISH_UNDEFINED` exists, and `cuttlefish_n(...)` is the nullish helper (with a `typehal_n` legacy alias). The exact current names for the exists-guard, halt, and string-temp helpers are intricate. **The pragmatic rule:** in `transpiler/type-mapping/+page.md`, perform the mechanical package/CLI swaps (Step 1) and the cache-dir + `typehal-env.d.ts` → `cuttlefish-env.d.ts` rename (Step 3, lines 23/57/60/61), but for the emitted-helper code blocks (lines 117, 132-133, 154-156, 171, 179, 185-186, 190, 196, 204, 280) **grep the current source first**:
```bash
rg -n "CUTTLEFISH_UNDEFINED|cuttlefish_n|n_nullish|n_exists|n_halt|__tc_str|__tc_float" packages/cuttlefish/src --type ts | head -20
```
Use whatever names the grep returns. If the grep is ambiguous or the helper was restructured, **leave that code block unchanged** (showing a slightly stale helper name is acceptable; showing a fabricated one is not). The package/CLI/config swaps are the load-bearing part of that task.

**Boundary-aware replacement:** use word boundaries. `@typehal/hal` → `@typecad/hal`, but never touch a hypothetical `typehalfoo`. The bare ambient module `@typehal` (no slash, e.g. `import { D13 } from '@typehal'`) becomes `@typecad` — this is the virtual board module.

---

## Phase 1 — Mechanical Rebrand Sweep (one commit)

Pure find/replace + targeted prose fixes. No new content. **31 files** have hits under `website/src/`. Files with **zero** hits (do not touch): everything under `src/lib/` except `lib/config/site.ts`; all of `routes/api/`, `routes/automate/`, `routes/code/`, `routes/examples/`, `routes/git/`, `routes/package/`, `routes/packages/`, `routes/news/`, `routes/sitemap[[page]].xml/`; `routes/+layout.svelte`, `routes/+layout.ts`, and all `src/app.*` files.

**News posts** (`routes/news/*.md`) are handled last and differently — see Task 1.6.

### Task 1.1: Global config — `site.ts`

**Files:**
- Modify: `website/src/lib/config/site.ts` (full file, 13 lines)

- [ ] **Step 1: Read the current file**

It currently reads:
```ts
export const siteConfig = {
	name: "typeHAL",
	url: "https://typecad.net",
	ogImage: "https://typecad.net/favico.ico",
	description: "TypeScript to C++ transpiler for embedded firmware",
	links: {
		github: "https://github.com/typecad/typecode",
	},
	keywords: `typeHAL,TypeScript,embedded,C++,transpiler,HAL,Arduino,ESP32,firmware,microcontroller`,
};

export type SiteConfig = typeof siteConfig;
```

- [ ] **Step 2: Replace the whole `siteConfig` object**

```ts
export const siteConfig = {
	name: "Cuttlefish",
	url: "https://typecad.net",
	ogImage: "https://typecad.net/favico.ico",
	description: "Cuttlefish — TypeScript to C++ transpiler for embedded firmware",
	links: {
		github: "https://github.com/typecad/typecode",
	},
	keywords: `Cuttlefish,typeCAD,TypeScript,embedded,C++,transpiler,HAL,Arduino,ESP32,firmware,microcontroller`,
};

export type SiteConfig = typeof siteConfig;
```

Changes: `name` → `"Cuttlefish"`; `description` prefixed with `Cuttlefish — `; `keywords` first token `typeHAL` → `Cuttlefish` and `typeCAD` added. `url`, `ogImage`, `github` unchanged.

- [ ] **Step 3: Verify**

`grep -n "typehal\|typeHAL" website/src/lib/config/site.ts` → no hits.

### Task 1.2: Home page — `routes/+page.svelte`

**Files:**
- Modify: `website/src/routes/+page.svelte:13,78,90`

- [ ] **Step 1: Read lines 1-20 and 75-95** to confirm exact current text.

- [ ] **Step 2: Fix the hero heading (line ~78)**

Replace:
```svelte
  <PageHeader.Heading>typeHAL</PageHeader.Heading>
```
with:
```svelte
  <PageHeader.Heading>Cuttlefish</PageHeader.Heading>
```

- [ ] **Step 3: Fix the hero tagline (line ~90)**

Replace:
```
        TypeScript + Embedded Safety = typeHAL
```
with:
```
        TypeScript + Embedded Safety = Cuttlefish
```

- [ ] **Step 4: Leave the rest of the home page intact.** The benefit-card grid, the `title`/`description` constants (they reference typeCAD/TypeScript+KiCAD, not typeHAL), and the SEO block are all correct. Do not restructure.

- [ ] **Step 5: Verify**

`grep -n "typehal\|typeHAL" website/src/routes/+page.svelte` → no hits.

### Task 1.3: Top-level `*.md` pages — getting-started

The only top-level page with hits is `getting-started/+page.md`. (The `routes/docs/+page.md` section index is handled in Task 1.4 with the rest of docs.)

**Files:**
- Modify: `website/src/routes/getting-started/+page.md`

- [ ] **Step 1: Read the full file.**

- [ ] **Step 2: Apply these exact replacements (line numbers from the audit):**

| Line | Find | Replace |
|---|---|---|
| 1 | `# Getting Started with typeHAL` | `# Getting Started with Cuttlefish` |
| 5 | `## What is typeHAL?` | `## What is Cuttlefish?` |
| 7 | `typeHAL is a TypeScript-to-C++ transpiler for embedded firmware.` | `Cuttlefish is a TypeScript-to-C++ transpiler for embedded firmware.` |
| 23 | `   npx @typehal/create my-project --board arduino-uno` | `   npx cuttlefish create my-project --target arduino-uno` |
| 31 | `   import { D13 } from '@typehal/board-arduino-uno';` | `   import { D13 } from '@typecad/board-arduino-uno';` |
| 42 | `   npx typehal build --compile --upload --port COM4` | `   npx cuttlefish build --compile --upload --port COM4` |
| 56 | `` | Create project | `npx @typehal/create my-project --board arduino-uno` | `` | `` | Create project | `npx cuttlefish create my-project --target arduino-uno` | `` |
| 57 | `` | Compile | `npx typehal build --compile` | `` | `` | Compile | `npx cuttlefish build --compile` | `` |
| 58 | `` | Upload | `npx typehal build --upload --port COM4` | `` | `` | Upload | `npx cuttlefish build --upload --port COM4` | `` |
| 59 | `` | Watch mode | `npx typehal build --watch --compile` | `` | `` | Watch mode | `npx cuttlefish build --watch --compile` | `` |
| 60 | `` | Diagnostics | `npx typehal build --diagnostics` | `` | `` | Diagnostics | `npx cuttlefish build --diagnostics` | `` |

Note: `--board arduino-uno` becomes `--target arduino-uno` because the current `cuttlefish create` CLI uses `--target` (with `--board` as an alias, but `--target` is canonical — see `packages/cuttlefish/src/utils/cli.ts`).

- [ ] **Step 3: Verify**

`grep -ni "typehal" website/src/routes/getting-started/+page.md` → no hits.

### Task 1.4: Docs section — HAL, ownership, simulation (mechanical sweep)

These pages need only package-scope and CLI swaps; no structural changes.

**Files:**
- Modify: `website/src/routes/docs/+page.md` (section index)
- Modify: `website/src/routes/docs/what-is-typecad/+page.md`
- Modify: all 5 files under `website/src/routes/docs/hal/`
- Modify: all 4 files under `website/src/routes/docs/ownership/` (owned, shared, mut, ownership-model, stateful-initialization)
- Modify: both files under `website/src/routes/docs/simulation/` (+page.md, software-defined-hardware, peripheral-mocking)
- Modify: `website/src/routes/docs/ownership/stateful-initialization/+page.md`

- [ ] **Step 1: Apply the universal package-scope sweep to every file above.**

For each file, replace every occurrence (do not add spaces, do not change anything else):
- `@typehal/` → `@typecad/`  (covers `@typehal/hal`, `@typehal/board-arduino-uno`, `@typehal/simulator`, `@typehal/expect`, `@typehal/core`, etc.)
- bare `'@typehal'` (the ambient virtual module, no trailing slash) → `'@typecad'`

- [ ] **Step 2: Fix the docs section index (`docs/+page.md`).**

Specific replacements (line numbers from audit):
| Line | Find | Replace |
|---|---|---|
| 3 | `const title: string = 'typeHAL Documentation';` | `const title: string = 'Cuttlefish Documentation';` |
| 5 | `const description: string = 'TypeHAL — TypeScript to C++ transpiler for embedded firmware';` | `const description: string = 'Cuttlefish — TypeScript to C++ transpiler for embedded firmware';` |
| 12 | `# typeHAL Documentation` | `# Cuttlefish Documentation` |
| 77 | `site_name: 'typeHAL',` | `site_name: 'Cuttlefish',` |

- [ ] **Step 3: Fix `docs/what-is-typecad/+page.md`.**

This page distinguishes typeCAD (PCB) from typeHAL (firmware). After rebrand, typeCAD stays the PCB brand and **Cuttlefish** is the firmware product.
| Line | Find | Replace |
|---|---|---|
| 22 | `## typeCAD and typeHAL` | `## typeCAD and Cuttlefish` |
| 27 | `- **typeHAL** — a TypeScript-to-C++ transpiler for firmware. Write firmware in TypeScript against typed hardware abstractions, then transpile to C++ for Arduino, ESP32, and other boards.` | `- **Cuttlefish** — a TypeScript-to-C++ transpiler for firmware. Write firmware in TypeScript against typed hardware abstractions, then transpile to C++ for Arduino, ESP32, and other boards.` |
| 58 | `Read through the [Getting Started](/getting-started) guide for a quick introduction to typeHAL, or explore the [typeCAD package docs](/docs/package/overview) for PCB design.` | `Read through the [Getting Started](/getting-started) guide for a quick introduction to Cuttlefish, or explore the [typeCAD package docs](/docs/package/overview) for PCB design.` |

- [ ] **Step 4: Fix prose mentions of "TypeHAL" as a product name in HAL/simulation pages.**

In `docs/hal/+page.md`, `docs/hal/analog-pwm/+page.md`, `docs/hal/communication-buses/+page.md`, `docs/hal/gpio-digital-io/+page.md`, `docs/hal/hardware-events/+page.md`, `docs/hal/signal-utilities/+page.md`, `docs/ownership/*`, and `docs/simulation/+page.md`: replace the prose product name `TypeHAL` → `Cuttlefish` (case-sensitive: `TypeHAL` only; do not touch `@typehal/` which Step 1 already handled). Examples: `The TypeHAL HAL provides…` → `The Cuttlefish HAL provides…`; `TypeHAL provides several ways…` → `Cuttlefish provides several ways…`. The string-literal `serial.println("TypeHAL Serial Initialized");` in `communication-buses/+page.md:20` becomes `serial.println("Cuttlefish Serial Initialized");`.

- [ ] **Step 5: Verify**

`grep -rni "typehal" website/src/routes/docs/hal website/src/routes/docs/ownership website/src/routes/docs/simulation website/src/routes/docs/+page.md website/src/routes/docs/what-is-typecad` → no hits.

### Task 1.5: Docs section — transpiler (emitted-identifier care)

**Files:**
- Modify: `website/src/routes/docs/transpiler/+page.md`
- Modify: `website/src/routes/docs/transpiler/type-mapping/+page.md`
- Modify: `website/src/routes/docs/transpiler/conflict-detection/+page.md`
- Modify: `website/src/routes/docs/transpiler/zero-cost-abstractions/+page.md`

The transpiler pages contain **emitted C++ identifiers** that were renamed. Handle carefully.

- [ ] **Step 1: Mechanical sweep on all four files.**

Replace everywhere:
- `@typehal/` → `@typecad/`  (covers `@typehal/framework-arduino`, `@typehal/framework-avr`, `@typehal/framework-native`, `@typehal/hal`, `@typehal/board-arduino-uno`, `@typehal/core`)
- `The TypeHAL transpiler` → `The Cuttlefish transpiler` (transpiler/+page.md:3)

- [ ] **Step 2: Fix `transpiler/+page.md` lines 30-31, 52, 57, 60-61.**

| Line | Find | Replace |
|---|---|---|
| 30 | `` - Nullish coalescing (`??`) becomes a `typehal_nullish` helper that preserves `0` and `false` `` | `` - Nullish coalescing (`??`) becomes a `cuttlefish_n` helper that preserves `0` and `false` `` |
| 31 | `` - Optional chaining (`?.`) becomes a `typehal_exists` guard `` | `` - Optional chaining (`?.`) becomes a `cuttlefish_exists` guard `` *(if `cuttlefish_exists` is not the real current name, grep `packages/cuttlefish/src/emit` for the exists-guard helper and use the real name; if you cannot find one, drop the parenthetical helper name and write "becomes a null-existence guard")* |
| 52 | `` - The `typehal map-error` command for manual error resolution `` | `` - The `cuttlefish map-error` command for manual error resolution `` |
| 57 | `The transpiler caches results in `.typehal-cache.json` using a toolchain fingerprint ...` | `The transpiler caches results in `.cuttlefish-cache.json` using a toolchain fingerprint ...` |
| 60 | `rm src/.typehal-cache.json` | `rm src/.cuttlefish-cache.json` |
| 61 | `typehal build` | `cuttlefish build` |

- [ ] **Step 3: Fix `transpiler/type-mapping/+page.md` — the emitted-identifier lines.**

First, grep current source for the real names:
```bash
grep -rn "CUTTLEFISH_UNDEFINED\|cuttlefish_n\|__tc_str\|cuttlefish_exists\|cuttlefish_halt" packages/cuttlefish/src/emit packages/cuttlefish/src/ir 2>/dev/null | head
```

Then apply (adjusting helper names to match what the grep returned):
| Line | Current text | New text |
|---|---|---|
| 23 | `### Type Aliases from `typehal-env.d.ts`` | `### Type Aliases from `cuttlefish-env.d.ts`` |
| 117 | `// C++: int (null handled via typehal_nullish)` | `// C++: int (null handled via cuttlefish_n)` |
| 132 | `char __typehal_str_1[32];` | `char __tc_str_1[32];` *(or the real prefix from the grep)* |
| 133 | `snprintf(__typehal_str_1, sizeof(__typehal_str_1), "Temperature: %dC", temp);` | `snprintf(__tc_str_1, sizeof(__tc_str_1), "Temperature: %dC", temp);` |
| 154 | `char __typehal_float_1[16];` | `char __tc_float_1[16];` *(or real prefix)* |
| 155 | `dtostrf(temperature, 0, 2, __typehal_float_1);` | `dtostrf(temperature, 0, 2, __tc_float_1);` |
| 156 | `snprintf(buf, sizeof(buf), "Temp: %sC", __typehal_float_1);` | `snprintf(buf, sizeof(buf), "Temp: %sC", __tc_float_1);` |
| 171 | `The `??` operator lowers to a `typehal_nullish` helper ...` | `The `??` operator lowers to a `cuttlefish_n` helper ...` |
| 179 | `int value = typehal_nullish<int, int>(input, 42);` | `int value = cuttlefish_n<int, int>(input, 42);` |
| 185 | `inline T typehal_nullish(T a, U b) {` | `inline T cuttlefish_n(T a, U b) {` |
| 186 | `  return (a != (T)TYPEHAL_UNDEFINED) ? a : (T)b;` | `  return (a != (T)CUTTLEFISH_UNDEFINED) ? a : (T)b;` |
| 190 | `This preserves `0` as a real value (only `TYPEHAL_UNDEFINED` triggers the fallback).` | `This preserves `0` as a real value (only `CUTTLEFISH_UNDEFINED` triggers the fallback).` |
| 196 | `The `?.` operator lowers through a `typehal_exists` guard:` | `The `?.` operator lowers through a `cuttlefish_exists` guard:` |
| 204 | `auto len = typehal_exists(obj) ? obj.length : /* default */;` | `auto len = cuttlefish_exists(obj) ? obj.length : /* default */;` |
| 280 | `typehal_halt("PANIC");` | `cuttlefish_halt("PANIC");` |

Also line 21: `@typehal/framework-arduino` → `@typecad/framework-arduino` (Step 1 covers this).

- [ ] **Step 4: Fix `transpiler/conflict-detection/+page.md` and `transpiler/zero-cost-abstractions/+page.md`.**

These only have package-import + CLI hits (covered by Step 1) plus:
- `conflict-detection/+page.md:253`: `typehal build --diagnostics` → `cuttlefish build --diagnostics`

- [ ] **Step 5: Verify**

`grep -rni "typehal" website/src/routes/docs/transpiler` → no hits.

### Task 1.6: News posts — CLI/package swaps only, prose product names stay

**Files:** all 15 `website/src/routes/news/*.md` posts. News posts are dated artifacts.

**Rule:** swap CLI commands and package scopes (so any instructions they contain reference the right binary), but **leave narrative product-name prose intact** — "we launched typeHAL" in a 2025 post stays historically accurate. The split: tokens that are *commands/imports* get swapped; tokens that are *prose product names* stay.

- [ ] **Step 1: Find which news posts contain command/import tokens.**

```bash
grep -rln "@typehal/\|npx typehal\|typehal build\|typehal init\|typehal create\|typehal\.config\|\.typehal" website/src/routes/news/
```

- [ ] **Step 2: For each file returned, apply only these swaps:**
- `@typehal/` → `@typecad/`
- `npx typehal` → `npx cuttlefish`
- `typehal build` → `cuttlefish build`
- `typehal init` → `cuttlefish create`
- `typehal create` → `cuttlefish create`
- `typehal.config.ts` → `cuttlefish.config.ts`
- `.typehal/` → `.cuttlefish/`

Do **not** replace bare `typeHAL` / `TypeHAL` prose mentions in news bodies.

- [ ] **Step 3: Verify**

```bash
grep -rni "@typehal/\|npx typehal\|typehal build\|typehal init\|typehal create\|typehal\.config\|\.typehal" website/src/routes/news/
```
→ no hits. (Bare `typeHAL`/`TypeHAL` prose mentions may remain — that is intended.)

### Task 1.7: Verify Phase 1 and commit

The ecosystem, testing, and cli-reference pages are intentionally **not** touched in Phase 1 — they get structural rewrites in Phase 3 (which will also sweep their remaining `typehal` tokens). So after Phase 1, `grep -rni typehal` will still show hits in `docs/ecosystem/` and `docs/testing/`. That is expected.

- [ ] **Step 1: Confirm Phase 1 scope is clean.**

```bash
grep -rni "typehal" website/src/routes website/src/lib | grep -v "routes/news/" | grep -v "routes/docs/ecosystem/" | grep -v "routes/docs/testing/"
```
→ must show zero hits. (News posts may keep prose mentions; ecosystem/testing are deferred to Phase 3.)

- [ ] **Step 2: Run svelte-check.**

```bash
npm run check --workspace website
```
Expected: passes (0 errors). If it fails on a typo introduced by the sweep, fix and re-run.

- [ ] **Step 3: Run the build.**

```bash
npm run build --workspace website
```
Expected: succeeds, no route 404s, every `.md` compiles via mdsvex.

- [ ] **Step 4: Commit.**

```bash
git add website/src/lib/config/site.ts website/src/routes/+page.svelte \
        website/src/routes/getting-started/+page.md \
        website/src/routes/docs/+page.md \
        website/src/routes/docs/what-is-typecad/+page.md \
        website/src/routes/docs/hal/ \
        website/src/routes/docs/ownership/ \
        website/src/routes/docs/simulation/ \
        website/src/routes/docs/transpiler/ \
        website/src/routes/news/
git commit -m "docs(website): rebrand typeHAL → Cuttlefish across existing pages

Mechanical sweep of product name (typeHAL → Cuttlefish), npm scope
(@typehal/* → @typecad/*), CLI (typehal → cuttlefish), config file
(typehal.config.ts → cuttlefish.config.ts), cache dir, and emitted C++
identifiers across site config, home page, getting-started, and the
hal/ownership/simulation/transpiler docs sections. News posts get
CLI/package swaps only; prose product-name mentions stay historically
accurate. Ecosystem and testing pages are deferred to Phase 3."
```

---

*(Phase 2 and Phase 3 continue below — adding the docs/ui/ section and the expect/ecosystem rewrite. Each is its own commit.)*

---

## Phase 2 — New `docs/ui/` Multi-Page Section (one commit)

Five new `+page.md` files under `website/src/routes/docs/ui/` + one sidebar entry in `docs.ts`. Content is drawn from `packages/ui/README.md` and `packages/ui/src/{index,types}.ts` (authoritative), reorganized for web navigation. Also reference `demo-ui-sd13/cuttlefish.config.ts` and `demo-st/cuttlefish.config.ts` for real config examples.

### Task 2.1: Section index — `docs/ui/+page.md`

**Files:**
- Create: `website/src/routes/docs/ui/+page.md`

- [ ] **Step 1: Create the file with this exact content.**

````markdown
---
title: Cuttlefish UI
description: HTML/CSS-driven graphics for microcontrollers
---

<script lang="ts">
	const title: string = 'Cuttlefish UI';
	const description: string = 'HTML/CSS-driven graphics for microcontrollers — write UIs in HTML + CSS, lower to a retained-mode C++ runtime.';
</script>

# Cuttlefish UI

Cuttlefish UI lets you build device graphics in HTML and CSS. You write a `.ui` file (HTML template + CSS + an optional TypeScript script), and the Cuttlefish transpiler lowers it to a retained-mode C++ runtime that draws directly to a display over SPI or I2C — no browser, DOM, or CSS engine on the device. All layout, style resolution, and font subsetting happen at transpile time; the firmware only runs the resulting draw calls.

The authoring library is `@typecad/ui` (compile-time only — none of its code ships to the device). It pairs with the display driver support built into `@typecad/cuttlefish`.

---

## Topics

| Topic | What you'll learn |
|-------|-------------------|
| [Elements](/docs/ui/elements) | The full HTML element catalog (`<screen>`, `<view>`, `<text>`, `<button>`, `<check>`, `<radio>`, `<select>`, `<progress>`, `<range>`, `<input>`, `<list>`, `<canvas>`, `<img>`) |
| [CSS & Styling](/docs/ui/css) | Box model, flexbox via Yoga, colors, typography, selectors, transitions, CSS variables, theming |
| [Display Configuration](/docs/ui/display-config) | Wiring displays in `cuttlefish.config.ts`, built-in profiles, touch input, display drivers |
| [Authoring API](/docs/ui/api) | The `ui.*` functions (`mount`, `signal`, `bind`, `drawCanvas`, …) and the `.ui` file format |

## First example

A minimal `.ui` file — a screen with a label and a button:

```html
<screen>
  <text id="label">Hello, Cuttlefish</text>
  <button id="ok">OK</button>
</screen>

<style>
  screen { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
  #label { font-size: 20px; color: #fff; }
  #ok { background: #2563eb; color: #fff; padding: 10px; text-align: center; }
</style>

<script lang="ts">
import { ui } from '@typecad/ui';
ui.mount(screen);
screen.ok.onClick(() => { screen.label.value = 1; });
</script>
```

Build with `cuttlefish build --compile --upload --port COM4`. The transpiler resolves the layout, subsets fonts, and emits the draw calls; `ui.mount(screen)` is intercepted and lowered to display initialization plus the first-frame draw.

## How it works

- **Author in HTML + CSS.** Use the elements catalog and a CSS subset that includes flexbox, the box model, colors, typography, and selectors.
- **Transpile-time resolution.** Layout runs through Yoga, styles are resolved, fonts are rasterized and subset to the glyphs you actually use, images are embedded as RGB565 byte arrays.
- **Retained-mode runtime.** The device holds a node tree; `ui_tick()` polls inputs, evaluates reactive bindings, and repaints only dirty regions (dirty-rectangle repaint). On boards with PSRAM, a full-screen framebuffer may be used.
- **Display-agnostic.** The same UI drives ILI9341 TFTs, SSD1309 OLEDs, ST7796 TFTs, SSD1680 e-ink panels, and an SDL desktop window for development.

Read [Elements](/docs/ui/elements) next for the full component catalog.
````

- [ ] **Step 2: Verify the file builds.**

```bash
npm run check --workspace website
```
If svelte-check complains about the `<script>` block in a `.md` file, check how `docs/+page.md` does it (the existing section index uses the same pattern) and match that exactly.

### Task 2.2: Elements catalog — `docs/ui/elements/+page.md`

**Files:**
- Create: `website/src/routes/docs/ui/elements/+page.md`

- [ ] **Step 1: Create the file with this content.**

````markdown
---
title: Cuttlefish UI Elements
description: The HTML element catalog for Cuttlefish UI
---

# Elements

Cuttlefish UI supports a focused set of HTML elements. Every UI has exactly one `<screen>` root; inside it you compose containers, text, controls, and media.

## The `<screen>` root

```html
<screen>
  ...children...
</screen>
```

Required. Exactly one per UI. Its box fills the display viewport (e.g. 320×240 landscape for an ILI9341). All other elements live inside it.

## Containers and text

### `<view>` — generic container

A block container. Supports `display: flex` for layout. Exposes `.value` plus `onToggle`/`onChange` for pin-driven state.

```html
<view id="row" style="display: flex; flex-direction: row; gap: 8px;">
  <text>Hello</text>
  <text>World</text>
</view>
```

### `<text>` — static or dynamic text

```html
<text id="label">Temperature</text>
```

Has a numeric `.value` property for state. To change the displayed string reactively, use `ui.bind(node, 'text', compute)` (see [Authoring API](/docs/ui/api)).

## Interactive elements

| Element | Purpose | `.value` |
|---------|---------|----------|
| [`<button>`](#button) | Tappable button (with `:pressed` state) | 0 / 1 |
| [`<check>`](#check) | Checkbox — tap to toggle | 0 / 1 |
| [`<radio name="g">`](#radio) | Radio — mutually exclusive within a `name` group | 0 / 1 |
| [`<select>`](#select) | Tap to cycle options | 0..N-1 |
| [`<progress>`](#progress) | Progress bar | 0-100 (fill %) |
| [`<range>`](#range) | Draggable slider | between `min` and `max` |
| [`<input>`](#input) | Text input (opens on-screen keyboard) | — (use `.text`) |
| [`<list>`](#list) | Virtualized, data-bound list | — |
| [`<canvas>`](#canvas) | User-drawn graphics via `ui.drawCanvas` | — |

### `<button>`

```html
<button id="ok">OK</button>
```

Supports the `:pressed` pseudo-state and transition animations (see [CSS](/docs/ui/css)). Events: `onClick` (short tap, up within 600ms), `onHold` (press ≥ 600ms), `onRelease`.

### `<check>`

```html
<check id="enable">Enable feature</check>
```

Content text is the label. `.value` is `0` (unchecked) or `1` (checked). `onToggle(pin, onChange?)` watches a GPIO pin for falling edges and flips `.value` automatically.

### `<radio>`

```html
<radio name="mode">Auto</radio>
<radio name="mode">Manual</radio>
```

Radios sharing the same `name` are mutually exclusive — selecting one deselects the others. `.value` is `0` or `1`.

### `<select>`

```html
<select id="mode">
  <option>Auto</option>
  <option>Manual</option>
  <option>Off</option>
</select>
```

Tapping cycles through the `<option>` children. `.value` is the index of the current option (0..N-1); the element's displayed text automatically reflects the current option.

### `<progress>`

```html
<progress id="load" value="40"></progress>
```

Read-only progress bar. `.value` is `0`-`100` (percentage filled).

### `<range>`

```html
<range id="brightness" min="0" max="100"></range>
```

A draggable slider. `.value` sits between `min` and `max` (defaults `0`-`100`). `onChange(callback?)` fires whenever `.value` changes during a drag. Drag the thumb or write `.value` from code.

### `<input>`

```html
<input id="ssid" type="text" placeholder="Network name" maxlength="32">
```

Text input. Tapping opens an on-screen keyboard. The string value lives in `.text` (not `.value`). `onChange(callback?)` fires after the keyboard commits. Attributes: `id`, `type`, `placeholder`, `maxlength`.

### `<list>`

```html
<list id="networks" item-height="28px"></list>
```

A virtualized, data-bound list — only visible items are rendered. Bind it to dynamic data with `ui.bindList(node, countFn, itemFn, onTap?)`. Attribute: `item-height`.

### `<canvas>`

```html
<canvas id="spark" width="120" height="40"></canvas>
```

A user-drawn region. Register a per-frame draw callback with `ui.drawCanvas(node, callback)`; the callback receives a `CanvasCtx` (see [Authoring API](/docs/ui/api)). Attributes: `width`, `height` (drawing buffer size in pixels).

## Images

### `<img>`

```html
<img id="logo" src="assets/logo.img" width="64" height="64">
```

Embeds a raw RGB565 `.img` file (flat row-major, `width × height × 2` bytes) as a `static const uint16_t[]`. Use `object-fit: contain | cover | fill` to control scaling. Attributes: `id`, `src`, `width`, `height`.

## HTML tag aliases

For familiarity, common HTML tags map to Cuttlefish primitives:

| HTML tag | Maps to | Notes |
|----------|---------|-------|
| `body`, `div`, `header`, `footer`, `nav`, `main`, `section`, `article`, `aside` | `<view>` | Block container |
| `span`, `p`, `h1`–`h6` | `<text>` | Inline/heading text |

## Global attributes

All elements support `hidden` — a hidden element (and its descendants) stays in the node table but takes no layout space and is skipped for drawing and hit-testing.

Next: [CSS & Styling](/docs/ui/css) for how to style these elements.
````

### Task 2.3: CSS & styling — `docs/ui/css/+page.md`

**Files:**
- Create: `website/src/routes/docs/ui/css/+page.md`

- [ ] **Step 1: Create the file with this content.**

````markdown
---
title: Cuttlefish UI CSS
description: CSS reference for Cuttlefish UI
---

# CSS & Styling

Cuttlefish UI resolves CSS at transpile time (no CSS engine runs on the device). It supports a practical subset of CSS: the box model, flexbox via [Yoga](https://github.com/facebook/yoga), the standard color formats, typography, and a full selector grammar.

## Box model

| Property | Values | Notes |
|----------|--------|-------|
| `padding` | `8px`, `8px 16px` | Shorthand supported |
| `margin` | `8px`, `8px 16px` | Shorthand supported |
| `width` / `height` | `100px`, `50px` | Explicit size |
| `min-width` / `max-width` / `min-height` / `max-height` | `100px` | Yoga constraints |
| `aspect-ratio` | `16 / 9`, `1 / 1`, `1.5` | Infers the missing dimension |
| `box-sizing` | `border-box` | Yoga border-box |
| `overflow` | `hidden`, `scroll` | `scroll` enables touch-drag scrolling |

## Length units

`px`, bare numbers, and `rem`/`em` (multiplied by 16, the root font size — so `0.625rem` = `10px`). Percentages are honored where applicable. `calc()` evaluates `+ - * /` on lengths after `var()` substitution, with operator precedence.

## Flexbox (via Yoga)

| Property | Values |
|----------|--------|
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
| `order` | `1`, `2`, … |
| `position` | `relative`, `absolute`, `static` |
| `top` / `right` / `bottom` / `left` | `10px` |
| `z-index` | numeric layers (inherited by descendants) |

> `display: none` removes the element subtree from layout, drawing, and hit-testing while preserving generated node indices.

## Colors

All standard CSS formats: `#rrggbb`, `#rgb`, `#rrggbbaa` (alpha ignored), `rgb(r,g,b)`, `rgba(r,g,b,a)` (alpha ignored), `hsl(...)`, `hsla(...)`. Both comma and CSS4 space syntaxes work. The 147 CSS named colors (`red`, `dodgerblue`, `transparent`, …) are supported.

## Typography

| Property | Values | Notes |
|----------|--------|-------|
| `color` | any color | Text foreground |
| `font-family` | `"MyFont"` | Uses a generated font when matched by `@font-face`; otherwise the built-in bitmap font |
| `font-size` | `16px` | Generated fonts rasterize at this pixel size |
| `font` | `italic bold 18px DeviceSans` | Shorthand for style/weight/size/family |
| `text-align` | `left`, `center`, `right` | |
| `text-decoration` | `underline`, `line-through`, `none` | Combine: `underline line-through` |
| `text-overflow` | `ellipsis`, `clip` | Truncates overflowing single-line text |
| `text-transform` | `uppercase`, `lowercase`, `capitalize`, `none` | Applied at transpile time |
| `line-height` | `1.5`, `150%`, `24px` | `normal` = font default |
| `letter-spacing` | `2px`, `-1px` | |
| `white-space` | `normal`, `nowrap`, `pre`, `pre-line` | |
| `font-weight` | `normal`, `bold`, `400`, `700` | Selects the matching `@font-face` variant |
| `font-style` | `normal`, `italic`, `oblique` | |
| `font-smoothing` | `anti aliased`, `none` | Overrides display-level antialiasing |
| `font-subset` | `exact`, `fallback` | Controls glyph selection for generated fonts |

### Fonts (`@font-face`)

Declare variants with `@font-face`. The transpiler rasterizes and subsets to the glyphs you actually use:

```css
@font-face {
  font-family: "DeviceSans";
  src: url("./assets/DeviceSans-Bold.ttf");
  font-weight: bold;
}
```

- `font-subset: exact` — include only the exact glyphs used (smallest binary).
- `font-subset: fallback` — include fallback glyphs for dynamic text that may contain unanticipated characters.
- `font-smoothing: antialiased` — enables per-pixel alpha for the matched text.

## Visual properties

| Property | Values | Notes |
|----------|--------|-------|
| `background` / `background-color` | any color | |
| `border` (shorthand) | `2px solid #808080` | |
| `border-width` / `border-color` / `border-style` | `2px` / color / `solid` `dashed` `none` | Dashed is approximated with segments |
| `border-radius` | `4px` | Uniform only (no per-corner) |
| `outline` | `1px solid #fff` | Drawn outside the element box |
| `visibility` | `visible`, `hidden` | |
| `box-shadow` | `inset 0 1px 0 #fff`, `0 10px 0 #333` | Up to 4 rect shadows; approximated |
| `transform` | `translateY(10px)`, `translate(0, 10px)` | Draw-time offset; no flex relayout |
| `opacity` | number | Blending requires a PSRAM framebuffer |

## Transitions and `:pressed`

```css
transition: background 300ms;
transition: color 120ms;
```

Lerps the property over the duration. The `:pressed` pseudo-class applies while a button's `.value` is `1`:

```css
#ok { background: #2563eb; transition: background 120ms; }
#ok:pressed { background: #1e40af; transform: translateY(2px); }
```

`:pressed` rules may include `top`/`left`/`right`/`bottom` or `transform: translate(...)` as draw-time offsets (outset shadows stay anchored).

## Selectors

| Kind | Example |
|------|---------|
| Element | `screen` |
| ID | `#title` |
| Class | `.card` |
| Compound | `.card.active`, `button.primary` |
| Descendant | `view text` |
| Child | `view > text` |
| Adjacent sibling | `.first + .second` |
| General sibling | `.first ~ .later` |
| Attribute | `[disabled]`, `[type="number"]` |
| Negation | `button:not(.disabled)`, `.a:not(.b.c)` |
| Pseudo-state | `:pressed`, `:disabled`, `:checked`, `:focus` |

Pseudo-states: `:pressed` (button held), `:disabled`, `:checked` (check/radio `.value` is `1`), `:focus`.

Inline `style="…"` attributes and `<style>` blocks are both supported.

## CSS variables and theming

Define variables in `:root` and reference with `var()`:

```css
:root {
  --bg: #111;
  --fg: #eee;
}
screen { background: var(--bg); color: var(--fg); }
```

**Class-scoped themes** select a variant at build time via `themeClass` in your `cuttlefish.config.ts`:

```css
:root { --bg: #fff; --fg: #000; }
.dark { --bg: #111; --fg: #eee; }
```
```ts
display: { themeClass: 'dark', /* … */ }
```

`@media` performs **compile-time** variant selection (no runtime resizing). Supported conditions: `min-width`, `max-width`, `min-height`, `max-height` (in `px`). `orientation` is unsupported (warned and skipped).

```css
@media (max-width: 200px) {
  screen { flex-direction: column; }
}
```

## Unsupported (and why)

These are intentionally out of scope for microcontroller rendering:

- `display: grid` — use flexbox
- Full inline rich text (mixed inline spans)
- `background-image` / CSS sprites — use `<img>` instead
- `position: fixed`
- `::before` / `::after` pseudo-elements
- `text-shadow` on the built-in font
- Per-corner `border-radius` (uniform only)
- Runtime theme switching (themes are resolved at transpile time)
- `@import`, `@supports`

Next: [Display Configuration](/docs/ui/display-config) for wiring a physical display.
````

### Task 2.4: Display configuration — `docs/ui/display-config/+page.md`

**Files:**
- Create: `website/src/routes/docs/ui/display-config/+page.md`

- [ ] **Step 1: Create the file with this content.** (Built-in profiles table reflects the **actual registry** — three profiles, not two.)

````markdown
---
title: Cuttlefish UI Display Configuration
description: Wiring displays and touch input for Cuttlefish UI
---

# Display Configuration

Cuttlefish UI drives physical displays through a `display` block in your `cuttlefish.config.ts`. The transpiler generates the right driver code from the configured profile and wiring.

## Minimal SPI example (ILI9341)

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/app.ui',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
  display: {
    profile: 'ili9341-spi',
    cs: 5,
    dc: 21,
    rst: 22,
    backlight: 17,
    antialias: true,
  },
};

export default config;
```

## Minimal I2C example (SSD1309 OLED)

```ts
display: {
  profile: 'ssd1309-i2c',
  bus: 'I2C',
  address: 0x3C,   // common OLED I2C address
  reset: -1,       // -1 if no reset pin wired
  rotation: 0,
}
```

## Profile fields

| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | Built-in profile name (e.g. `"ili9341-spi"`) — fills in `driver`, `width`, `height`, `colorFormat`, `rotation` |
| `driver` | string | Display driver id (e.g. `"ili9341"`) — set explicitly to override the profile |
| `width` / `height` | number | Display dimensions in pixels (after rotation) |
| `colorFormat` | `"rgb565"` \| `"mono"` | Color depth |
| `rotation` | number | `0` = portrait, `1` = landscape, `2`-`3` = inverted |
| `backlight` | number | Backlight pin (optional) |
| `cs` / `dc` / `rst` | number | SPI wiring pins |
| `bus` | string | Bus identifier (`"SPI"` or `"I2C"`) |
| `address` | number | I2C address (I2C displays) |
| `reset` | number | Reset pin for I2C displays (`-1` if unwired) |
| `spiFrequency` | number | SPI frequency override |
| `colorOrder` | string | Pixel color order (e.g. `"bgr"`) |
| `invertDisplay` | boolean | Invert panel colors |
| `antialias` | boolean | Enable text antialiasing |
| `themeCss` | string | Path to an extra CSS file with theme rules |
| `themeClass` | string | Class name selecting a build-time theme variant |
| `scroll` | `{ dragScale: number }` | Scroll-drag tuning |
| `touch` | object | Touch-input config (see below) |

## Built-in profiles

| Profile | Driver | Dimensions | Color | Notes |
|---------|--------|------------|-------|-------|
| `ili9341-spi` | `ili9341` | 320×240 | RGB565 | Landscape; add touch via `touch` config |
| `st7796-spi` | `st7796` | 480×320 | RGB565 | ST7796S TFT; native 320×480, rotated landscape |
| `ssd1309-i2c` | `ssd1309` | 128×64 | Mono | SSD1309-class OLED over I2C |

## Registered display drivers

Beyond the built-in profiles, the transpiler registers drivers you can target directly by setting `driver` (and `width`/`height`/`colorFormat`):

| Driver | Targets |
|--------|---------|
| `ili9341` | ILI9341 SPI TFT (RGB565) |
| `st7796` | ST7796S SPI TFT (RGB565 / RGB666) |
| `ssd1309` | SSD1309 OLED (1-bit mono, I2C, page-buffered) |
| `ssd1680` | SSD1680-class e-ink (1-bit, deferred partial refresh) |
| `sdl` | Native desktop window (RGB888) — for development without hardware |

## Touch input

Add a `touch` block to enable touch. Three built-in libraries are supported, plus a custom adapter path.

### `XPT2046_Touchscreen` (SPI resistive)

```ts
touch: {
  library: 'XPT2046_Touchscreen',
  cs: 14,
  irq: 2,                       // optional
  calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
  minPressure: 10,
}
```

### `Adafruit_TouchScreen` (analog resistive)

```ts
touch: {
  library: 'Adafruit_TouchScreen',
  analogPins: { xp, yp, xm, ym, rx },
  calibration: { xMin, xMax, yMin, yMax },
  minPressure: 10,
}
```

### `Adafruit_STMPE610` (SPI or I2C capacitive)

```ts
touch: {
  library: 'Adafruit_STMPE610',
  cs: 14,
  calibration: { xMin, xMax, yMin, yMax },
  minPressure: 10,
}
```

### Custom adapter

```ts
touch: {
  adapter: './my-touch-adapter',
  calibration: { xMin, xMax, yMin, yMax },
  minPressure: 10,
}
```

### Calibration

`calibration` maps raw touch-controller readings to display pixels: `{ xMin, xMax, yMin, yMax }`. `minPressure` filters out feather-light touches.

## Adding a new display driver

For drivers not in the built-in set, register an adapter at build time. The runtime contract every adapter must satisfy is the core display API:

- `display_init()`
- `display_fillScreen(color)`
- `display_startWrite()` / `display_endWrite()`
- `display_setAddrWindow(x, y, w, h)`
- `display_writePixels(pixels, count)`
- `display_partial_refresh(x, y, w, h)`

Register with `registerDisplayAdapter(driver, generator)` and provide a `DisplayProfile` so the transpiler knows the dimensions and color format. (See `packages/cuttlefish/src/api/shared/display-adapter.ts` for the generator interface.)

Next: [Authoring API](/docs/ui/api) for the `ui.*` functions and the `.ui` file format.
````

### Task 2.5: Authoring API — `docs/ui/api/+page.md`

**Files:**
- Create: `website/src/routes/docs/ui/api/+page.md`

- [ ] **Step 1: Create the file with this content.**

````markdown
---
title: Cuttlefish UI Authoring API
description: The ui.* functions and the .ui file format
---

# Authoring API

The `ui` object from `@typecad/ui` is your authoring surface. It is **compile-time only** — every method is intercepted by the Cuttlefish transpiler and lowered to device code. If you call one at runtime (e.g. in a plain Node script), it throws a "compile-time construct" error.

```ts
import { ui } from '@typecad/ui';
```

## `ui.mount(tree, opts?)`

Mount a baked UI tree to the configured display. Validates the driver against the active framework at transpile time; lowers to display initialization plus the first-frame draw.

```ts
ui.mount(screen);
ui.mount(screen, { spiFrequency: 40_000_000 });
```

`MountOptions` (all optional): `display`, `bus`, `cs`, `dc`, `rst`, `rotation`, `backlight`, `spiFrequency`, `address` (I2C), `reset` (I2C).

## `ui.signal(initial)`

Declare a reactive signal. Lowers to a device variable plus a dirty flag. Three overloads narrow the type from the initial value:

```ts
const level = ui.signal(0);     // Signal<number>
const label = ui.signal('Hi');  // Signal<string>
const on = ui.signal(false);    // Signal<boolean>
```

A `Signal<T>` is callable to read (`level()`) and has `.set(value)` to write (`level.set(50)`).

## `ui.bind(node, property, compute)`

Bind a node property to a recomputed value, evaluated each tick. Marks the node dirty when the value changes. Supported properties include `color`, `background`, `borderColor`, `value`, `visible`, and `text`.

```ts
ui.bind(screen.label, 'text', () => `Level: ${level()}`);
ui.bind(screen.bar, 'value', () => level());
```

## `ui.bindInput(node, onText)`

Subscribe to an `<input>` element's text. The callback fires after the on-screen keyboard commits.

```ts
ui.bindInput(screen.ssid, (text) => { console.log(`SSID: ${text}`); });
```

## `ui.bindList(node, countFn, itemFn, onTap?)`

Bind a `<list>` to dynamic data. Virtualized — only visible items render. `countFn` returns the item count (called each frame); `itemFn` returns the label for a given index; `onTap` (optional) fires when an item is tapped.

```ts
ui.bindList(
  screen.networks,
  () => scanResults.length,
  (i) => scanResults[i].name,
  (i) => connectTo(scanResults[i]),
);
```

## `ui.watchPin(pin, onFalling)`

Watch a GPIO pin for falling edges (a button press). Runs as an async task in the microtask pump (~20ms poll) — no ISR. Use for buttons wired to GPIO when you don't have a touch screen.

```ts
ui.watchPin(D2, () => { screen.count.value++; });
```

## `ui.onTap(node?)`

An awaitable tap signal for use inside `async` functions. No argument resumes on the next tap anywhere (including empty space); pass an element to resume only on that element. Use for "tap to continue" flows and display-sleep/screensaver wake.

```ts
await ui.onTap(screen.continueButton);
showNextPage();
```

## `ui.drawCanvas(node, callback)`

Register a per-frame draw callback for a `<canvas>` element. Coordinates are canvas-relative and auto-clipped. Color arguments are CSS strings resolved to RGB565 at transpile time. The callback receives a `CanvasCtx`:

```ts
ui.drawCanvas(screen.scope, (ctx) => {
  ctx.fillScreen('#000');
  ctx.line(0, 0, ctx.width, ctx.height, '#0f0');
  ctx.fillCircle(ctx.width / 2, ctx.height / 2, 8, '#f00');
  ctx.text(4, 4, `${screen.load.value}`, '#fff');
});
```

### `CanvasCtx`

| Method | Signature |
|--------|-----------|
| `width` / `height` | `readonly number` |
| `drawPixel` | `(x, y, color)` |
| `fillRect` | `(x, y, w, h, color)` |
| `rect` | `(x, y, w, h, color)` |
| `fillRoundRect` | `(x, y, w, h, r, color)` |
| `roundRect` | `(x, y, w, h, r, color)` |
| `line` | `(x0, y0, x1, y1, color)` |
| `hline` | `(x, y, w, color)` |
| `vline` | `(x, y, h, color)` |
| `fillCircle` | `(x, y, r, color)` |
| `circle` | `(x, y, r, color)` |
| `rgbBitmap` | `(x, y, data: number[], w, h)` |
| `text` | `(x, y, str, color?)` |
| `fillScreen` | `(color)` |

## `ui.window` (native SDL only)

Native-desktop window controls. No-ops on hardware targets.

```ts
ui.window.setTitle('My App');
ui.window.setIcon('./assets/icon.png');
```

## Element types and `.value`

Every element exposes `.value: number` (its state) plus `onClick`, `onHold`, `onRelease`. Specific elements add more:

| Type | Notable members |
|------|-----------------|
| `CheckElement` | `onToggle(pin, onChange?)` — `.value` flips on a GPIO falling edge |
| `RangeElement` | `onChange(callback?)` — fires while the thumb drags |
| `InputElement` | `text: string`, `onChange(callback?)` |
| `SelectElement` | `.value` cycles `0..N-1`; text auto-reflects the option |
| `RadioElement` | `.value` is `0`/`1`; mutually exclusive within a `name` group |
| `ProgressElement` | `.value` is `0`-`100` (read-only) |

The named `screen.*` references (e.g. `screen.label`, `screen.ok`) are typed against a generated per-file `ScreenTree` whose fields match the `id` attributes in your template.

## The `.ui` single-file component

A `.ui` file has up to three sections, in any order: `<script>`, `<style>`, and the HTML template (typically `<screen>...</screen>`). Only one `<script>` block is allowed; multiple `<style>` blocks are concatenated.

```html
<script lang="ts">
import { ui } from '@typecad/ui';
export const level = ui.signal(0);
ui.mount(screen);
setInterval(() => level.set((level() + 1) % 100), 250);
</script>

<style>
:root { --bg: #111; --fg: #eee; }
screen { background: var(--bg); color: var(--fg); padding: 12px; }
#bar { height: 16px; background: #2563eb; }
</style>

<screen>
  <text id="label">Progress</text>
  <progress id="bar"></progress>
</screen>
```

The transpiler injects an implicit `import { screen } from './app.ui.html'` so the template is referenceable as `screen.*` inside the script.

### Accepted entry extensions

Point your `cuttlefish.config.ts` `entry` at any of `.ts`, `.tsx`, or `.ui`.

### Two project layouts

**Pattern A — single-file `.ui`:** script, style, and template in one file. The entry is the `.ui` file.

**Pattern B — split `main.ts` + `.ui.html`:** keep logic in `main.ts` and the template in a `.ui.html` file; import the template from the script. Useful for larger UIs.

## State, input, and timing

- **`.value`** reads/writes element state (`screen.check.value = 1`).
- **Pin input** — `onToggle(pin, onChange?)` on `<check>`/`<view>`; `ui.watchPin(pin, onFalling)` for arbitrary GPIO.
- **Touch events** — `onClick` (up within 600ms), `onHold` (≥ 600ms), `onRelease`, with ~50ms debounce.
- **Two-way input binding** — `ui.bindInput(node, onText)` for `<input>`.
- **Slider changes** — `onChange(callback?)` on `<range>`.
- **Data-bound lists** — `ui.bindList(node, countFn, itemFn, onTap?)`.
- **Signals** — reactive values via `ui.signal`; read with `sig()`, write with `sig.set(...)`.
- **Timers** — standard `setInterval`/`setTimeout` work; they lower to the device's task loop.

## Architecture

- **Retained-mode runtime.** `ui_mount` initializes the display; `ui_tick` (called each loop) polls inputs, evaluates bindings and transitions, and repaints dirty regions; `ui_init` marks all nodes dirty for the first frame.
- **Dirty-rectangle repaint.** Only changed regions are redrawn and pushed.
- **PSRAM-gated framebuffer.** When `BOARD_HAS_PSRAM` and `psramFound()` are true, a full-screen `GFXcanvas16` framebuffer may be used to hide tearing on small updates.

Back to [Cuttlefish UI overview](/docs/ui).
````

### Task 2.6: Wire the sidebar

**Files:**
- Modify: `website/src/lib/config/docs.ts:32-159` (the `docsNav` array)

- [ ] **Step 1: Add the new sidebar group.**

In `docs.ts`, inside the `docsNav: [ ... ]` array, insert this new group **between** the "Transpiler & Language Engine" entry (ends at line ~104) and the "Hardware Simulation" entry (starts at line ~106):

```ts
		{
			title: "User Interface (Cuttlefish UI)",
			href: "/docs/ui",
			items: [
				{
					title: "Elements",
					href: "/docs/ui/elements",
					items: [],
				},
				{
					title: "CSS & Styling",
					href: "/docs/ui/css",
					items: [],
				},
				{
					title: "Display Configuration",
					href: "/docs/ui/display-config",
					items: [],
				},
				{
					title: "Authoring API",
					href: "/docs/ui/api",
					items: [],
				},
			],
		},
```

Match the existing indentation (tabs) and trailing-comma style of the surrounding entries.

### Task 2.7: Verify Phase 2 and commit

- [ ] **Step 1: Run svelte-check.**

```bash
npm run check --workspace website
```
Expected: passes.

- [ ] **Step 2: Run the build.**

```bash
npm run build --workspace website
```
Expected: succeeds. Confirm the new routes compile: look for the five `docs/ui/*` pages in the build output with no 404s.

- [ ] **Step 3: Spot-check the new pages render.**

If a local dev server is feasible, `npm run dev --workspace website` and visit `/docs/ui`, `/docs/ui/elements`, `/docs/ui/css`, `/docs/ui/display-config`, `/docs/ui/api`. Confirm the sidebar shows the new group and the table of contents renders. (If a dev server isn't feasible in this environment, the build succeeding is sufficient — mdsvex would fail the build on malformed markdown.)

- [ ] **Step 4: Commit.**

```bash
git add website/src/routes/docs/ui/ website/src/lib/config/docs.ts
git commit -m "docs(website): add docs/ui section for @typecad/ui

Five new pages — overview, elements catalog, CSS reference, display
configuration, and authoring API — documenting the HTML/CSS-driven
microcontroller UI library. Content drawn from packages/ui/README.md
and the public types in packages/ui/src. Sidebar group added between
Transpiler and Simulation. Built-in display profiles table reflects
the actual registry (ili9341-spi, st7796-spi, ssd1309-i2c)."
```

---

## Phase 3 — Expect Docs Rewrite + Ecosystem Restructure (one commit)

Two sub-parts: (3A) rewrite the `docs/testing/` section to use `@typecad/expect` + the `cuttlefish-test` binary, adding a dedicated `expect/` page; (3B) restructure `docs/ecosystem/` to drop the four deleted packages, add the new ones, fix the config shape and scaffolding command, and update the CLI reference. This phase also sweeps the last remaining `typehal` tokens (which Phase 1 deliberately skipped here).

### Task 3.1: Rewrite `docs/testing/+page.md` (section index)

**Files:**
- Modify: `website/src/routes/docs/testing/+page.md` (full rewrite)

- [ ] **Step 1: Replace the entire file contents with:**

````markdown
# Testing & Diagnostics

Cuttlefish provides two complementary testing approaches: hardware-in-the-loop testing on real devices, and source-mapped diagnostics that map C++ errors back to TypeScript.

---

## Topics

| Topic | What you'll learn |
|-------|-------------------|
| [Hardware-in-the-Loop (HIL)](/docs/testing/hil) | Run unit tests on a physical microcontroller over serial |
| [Expect Assertion API](/docs/testing/expect) | The full `@typecad/expect` matcher reference and config |
| [Source-Mapped Diagnostics](/docs/testing/source-mapped-diagnostics) | Map C++ compiler errors back to TypeScript source lines |

## Two Approaches

### Hardware-in-the-Loop (HIL)
Write vitest-style assertions with `@typecad/expect` that run on the actual microcontroller. The `cuttlefish-test` CLI transpiles your tests, uploads them, and reports pass/fail over serial. This catches real hardware issues — wrong pin voltages, bus timing, sensor calibration.

### Source-Mapped Diagnostics
When C++ compilation fails (type errors, missing symbols, linker issues), source maps translate the error location back to the TypeScript file and line. No more manually correlating generated C++ with your source.

## Quick Example: HIL Test

```ts
import { describe, done } from '@typecad/expect';
import { A0 } from '@typecad';

describe('Analog sensor')
  .it('reads within valid range')
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it('is above noise floor')
    .expect(A0.readAnalog()).toBeGreaterThan(10);

done();
```

Run the tests with the dedicated test binary:

```bash
cuttlefish-test --port COM4
```

## Quick Example: Source-Mapped Error

When compilation fails:
```bash
cuttlefish build --compile
# Error maps automatically:
# C++ error at out/sketch.ino:42:10
#   -> src/sketch.ts:15:8 (CallExpression: readAnalog)
#   error: 'readAnalog' was not declared
```

For a detailed report with pin usage, peripheral allocation, and heap estimates:
```bash
cuttlefish build --diagnostics
# Generates diagnostics.md and diagnostics.json
```

## Test Workflow

1. Write firmware and tests in TypeScript using `@typecad/expect`
2. Run `cuttlefish-test --port COM4` (transpiles, compiles, uploads, reports)
3. Use `cuttlefish build --diagnostics` for a comprehensive build report

See [HIL Testing](/docs/testing/hil) for the full flow, [Expect Assertion API](/docs/testing/expect) for the matcher reference, and [Source-Mapped Diagnostics](/docs/testing/source-mapped-diagnostics) for source map details.
````

### Task 3.2: Rewrite `docs/testing/hil/+page.md`

**Files:**
- Modify: `website/src/routes/docs/testing/hil/+page.md` (full rewrite)

- [ ] **Step 1: Replace the entire file contents with:**

````markdown
# Hardware-in-the-Loop (HIL) Testing

Run unit tests on a physical microcontroller over serial using `@typecad/expect`. You write vitest-style assertions in TypeScript; the framework transpiles them to firmware, uploads to the board, reads results over serial, and reports pass/fail in one command.

## How it works

The `cuttlefish-test` binary runs a seven-stage pipeline:

1. **Preprocess** — an AST transform rewrites your fluent assertion chains into `Serial.print` calls.
2. **Transpile** — Cuttlefish converts the TypeScript test to C++.
3. **Compile** — `arduino-cli compile` builds the sketch.
4. **Upload** — `arduino-cli upload` flashes the board.
5. **Capture** — the host reads structured serial lines from the board.
6. **Evaluate** — assertion math runs on the host (the firmware only sends raw values).
7. **Report** — vitest-style pass/fail output.

## The `@typecad/expect` API

```ts
import { describe, done } from '@typecad/expect';
import { A0, D13 } from '@typecad';

describe('Pin behavior')
  .it('reads a valid ADC value')
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it('drives the LED high')
    .expect(D13.read() ? 1 : 0).toBeTruthy();

done();
```

- `describe(name)` opens a group and returns a `Suite` you chain on.
- `.it(name)` starts a test case within the current group.
- `.expect(actual)` asserts a numeric value (or a function returning one).
- `.expectString(actual)` asserts a string value.
- `done()` must be the last statement in every test file — it emits the end-of-suite sentinel.

Every matcher returns the `Suite`, so you chain `.it(...).expect(...).matcher(...)` fluently. See [Expect Assertion API](/docs/testing/expect) for every matcher.

## Running tests

```bash
cuttlefish-test --port COM4
cuttlefish-test --port COM4 tests/sensor.test.ts     # one file
cuttlefish-test -p /dev/ttyACM0 -v                   # verbose
```

You can also run tests through the main `cuttlefish` CLI:

```bash
cuttlefish build --compile --upload --expect --port COM4
cuttlefish build --expect tests/sensor.test.ts --port COM4
cuttlefish build -w --compile --upload --expect --port COM4   # watch mode
```

## Configuration

Add a `test` section to your `cuttlefish.config.ts`:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/sketch.ts',
  target: 'avr',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'arduino:avr:uno' },
  test: {
    include: ['tests/**/*.test.ts'],
    port: 'COM4',
    baudRate: 115200,
    timeout: 30000,
  },
};

export default config;
```

CLI flags override config values. See [Expect Assertion API](/docs/testing/expect) for the full `test` config schema and all CLI flags.

## Per-target skip directives

Some tests only apply to certain architectures. Add a file-level comment:

```ts
// @typecad-skip-target esp32: ESP32 does not expose the AVR watchdog API.
```

or:

```ts
// @typecad-only-target avr,megaavr: uses AVR watchdog registers.
```

Targets are matched against your `target`, the FQBN parts in `frameworkData.buildTarget` (e.g. `esp32` in `esp32:esp32:esp32`), the full FQBN, and the board package name. Skipped files are reported in the output; run with `--verbose` to see the reason.

## Full example

```ts
import { describe, done } from '@typecad/expect';
import { A0, D2, D13, I2C0 } from '@typecad';
import { millis } from '@typecad/hal';

describe('Sensor suite')
  .it('reads temperature within range')
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it('responds within 50ms')
    .expect(millis()).toBeGreaterThan(0)
  .it('I2C bus is addressable')
    .expect(I2C0.scan().length).toBeGreaterThanOrEqual(0);

done();
```

Run `cuttlefish-test --port COM4`. The output is vitest-style:

```
 ✓ tests/sensor.test.ts (3 passed)
 Tests  3 passed (3)
 PASS   All tests passed
```

For the complete matcher reference and config details, see [Expect Assertion API](/docs/testing/expect). For mapping compile errors back to TypeScript, see [Source-Mapped Diagnostics](/docs/testing/source-mapped-diagnostics).
````

### Task 3.3: Create `docs/testing/expect/+page.md` (new page)

**Files:**
- Create: `website/src/routes/docs/testing/expect/+page.md`

- [ ] **Step 1: Create the file with this content.**

````markdown
---
title: Cuttlefish Expect Assertion API
description: The @typecad/expect matcher reference and test configuration
---

# Expect Assertion API

`@typecad/expect` is a hardware test framework with a vitest-style fluent API. Write assertions in TypeScript; the `cuttlefish-test` CLI compiles them to firmware, runs them on the board, and reports results over serial. All assertion math runs on the host — the firmware only sends raw values.

## Install

`@typecad/expect` ships in the TypeCAD monorepo. In a workspace project it's already available; otherwise install it alongside `@typecad/cuttlefish`:

```bash
npm install @typecad/expect @typecad/cuttlefish
```

## The fluent chain

```ts
import { describe, done } from '@typecad/expect';

describe('Group name')
  .it('test case name')
    .expect(actualValue).matcher(expected)
  .it('another case')
    .expect(actualValue).matcher(expected);

done();
```

- `describe(name: string): Suite` — opens a group.
- `Suite.it(name: string): Suite` — opens a test case.
- `Suite.expect(actual: number | (() => number)): Expectation` — assert a numeric value.
- `Suite.expectString(actual: string | (() => string)): StringExpectation` — assert a string value.
- `done(): void` — **required** as the last statement; emits the end-of-suite sentinel and enters an idle loop so the host knows the firmware is finished.

Every matcher returns `Suite`, so you chain `.it().expect().matcher()` without semicolons between steps.

## Numeric matchers (`Expectation`)

| Matcher | Asserts |
|---------|---------|
| `.toBe(expected)` | `actual === expected` |
| `.toBeGreaterThan(n)` | `actual > n` |
| `.toBeGreaterThanOrEqual(n)` | `actual >= n` |
| `.toBeLessThan(n)` | `actual < n` |
| `.toBeLessThanOrEqual(n)` | `actual <= n` |
| `.toBeCloseTo(n, precision)` | `|actual − n| < 10^(−precision)` (default precision `2` → `0.01`) |
| `.toBeWithinRange(min, max)` | `actual >= min && actual <= max` |
| `.toBeTruthy()` | `actual !== 0` |
| `.toBeFalsy()` | `actual === 0` |
| `.toNotBe(expected)` | `actual !== expected` |

`actual` may be a value or a zero-arg function returning a value (`() => A0.readAnalog()`).

## String matchers (`StringExpectation`)

| Matcher | Asserts |
|---------|---------|
| `.toBe(expected)` | exact string equality |
| `.toContain(substring)` | substring is present |
| `.toHaveLength(n)` | string length equals `n` |
| `.toNotBe(expected)` | not equal |

String expectations are for software string variables, not raw hardware reads.

## Worked example

```ts
import { describe, done } from '@typecad/expect';
import { A0, A1 } from '@typecad';

describe('A0 analog read')
  .it('reads a value in valid ADC range')
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023)
  .it('reads less than mid-scale when grounded')
    .expect(A0.readAnalog()).toBeLessThan(512);

describe('A1 analog read')
  .it('returns a non-negative value')
    .expect(A1.readAnalog()).toBeGreaterThanOrEqual(0)
  .it('is within 10-bit ADC range')
    .expect(A1.readAnalog()).toBeLessThanOrEqual(1023);

done();
```

You can also assert on plain TypeScript values (enums, arrays, destructuring, function results), not just hardware reads:

```ts
import { describe, done } from '@typecad/expect';

enum Mode { Idle = 0, Active = 1 }
const baseline: ReadonlyArray<number> = [1, 2, 3, 4];

function baselineSum(): number {
  let total = 0;
  for (const v of baseline) total += v;
  return total;
}

describe('Logic correctness')
  .it('sums readonly arrays correctly')
    .expect(baselineSum()).toBe(10)
  .it('returns enum-backed values correctly')
    .expect(chooseMode(true)).toBe(1);

done();
```

## The `cuttlefish-test` CLI

```bash
cuttlefish-test [options] [files...]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port <port>` | `-p` | from config | Serial port (e.g. `COM4`, `/dev/ttyACM0`) |
| `--board <pkg>` | `-b` | from config | Board package override |
| `--build-target <fqbn>` | | from config | Framework-specific build target / FQBN override |
| `--baud <rate>` | | `115200` | Serial baud rate |
| `--timeout <ms>` | `-t` | `30000` | Serial read timeout in milliseconds |
| `--include <glob>` | `-i` | from config | Test file glob pattern (repeatable) |
| `--exclude <glob>` | `-x` | from config | Test file glob pattern to skip (repeatable) |
| `--verbose` | `-v` | off | Show raw serial output and per-assertion detail |
| `--help` | `-h` | | Print help and exit |

Positional file arguments are treated as `--include` patterns (overriding config). Defaults for `board`, `target`, and `buildTarget` fall back to your `cuttlefish.config.ts` root fields when the `test` section doesn't set them — so only `--port` is typically required on the command line.

## Test configuration

Add a `test` section to `cuttlefish.config.ts`:

```ts
test: {
  include: ['tests/**/*.test.ts'],   // required — glob patterns for test files
  exclude: ['tests/slow/**'],        // optional — patterns to skip after discovery
  port: 'COM4',                      // required — serial port
  baudRate: 115200,                  // required — default 115200
  timeout: 30000,                    // required — default 30000 ms
  serialOpenDelay: 500,              // optional — delay before opening serial (after reset); default 500
  resetAfterOpen: true,              // optional — toggle ESP32-style DTR/RTS reset after opening
  buildTarget: 'arduino:avr:uno',    // optional — overrides the root frameworkData.buildTarget
  board: '@typecad/board-arduino-uno', // optional — overrides the root board
  // verbose: not settable from config; use the --verbose CLI flag
}
```

Merge precedence: **defaults < config file < CLI flags** (per field).

## Serial protocol

The firmware emits structured lines the host parses:

- `[TC:SUITE_START]`
- `[TC:DESCRIBE:<name>]`
- `[TC:IT:<name>]`
- `[TC:EXPECT:<matcher>:<expected>:<actual>]`
- `[TC:SUITE_END]`

All non-`[TC:` lines are treated as debug output and shown with `--verbose`.

## Per-target skip directives

File-level comments control which targets run a test:

```ts
// @typecad-skip-target esp32: ESP32 lacks the AVR watchdog API.
// @typecad-only-target avr,megaavr: uses AVR watchdog registers.
```

Targets are matched against: your `target`, the FQBN parts of `frameworkData.buildTarget`, the full FQBN, and the board package name. Skipped files appear in the output (vitest-style `↓ tests/x.test.ts (skipped)`); run with `--verbose` to print the reason.

## Limitations

- No callback suites — groups and cases are defined by fluent chaining, not `describe("name", () => { ... })`.
- No async tests — timing is implicit (the board executes sequentially; the host waits on serial).
- Sequential execution — all `describe` blocks in a file run once, in order, inside `setup()`. No `beforeEach`/`afterEach`.
- One file per upload — each test file produces one sketch and one upload cycle.
- Numeric types only for hardware values — Cuttlefish maps hardware reads to `int`/`float`. Use `expectString` only for software string variables.

Back to [Testing & Diagnostics](/docs/testing).
````

### Task 3.4: Sweep `docs/testing/source-mapped-diagnostics/+page.md`

**Files:**
- Modify: `website/src/routes/docs/testing/source-mapped-diagnostics/+page.md`

- [ ] **Step 1: Read the file.** Apply mechanical swaps:
- `typehal map-error` → `cuttlefish map-error` (line ~52)
- `typehal build` → `cuttlefish build` (lines ~74, ~98)
- `@typehal/board-arduino-uno` → `@typecad/board-arduino-uno` (line ~137)
- `@typehal/framework-arduino` → `@typecad/framework-arduino` (line ~138)

Leave everything else (the source-map concept, the `.thcppmap.json` suffix references, the workflow) intact. The `.thcppmap.json` suffix is **unchanged** by the rebrand.

- [ ] **Step 2: Verify.**

`grep -ni "typehal" website/src/routes/docs/testing/source-mapped-diagnostics/+page.md` → no hits.

### Task 3.5: Add `expect` to the testing sidebar

**Files:**
- Modify: `website/src/lib/config/docs.ts` (the "Testing & Diagnostics" group in `docsNav`)

- [ ] **Step 1: Update the Testing group.**

Find the `Testing & Diagnostics` entry (currently two children: `hil`, `source-mapped-diagnostics`) and replace it with three children:

```ts
		{
			title: "Testing & Diagnostics",
			href: "/docs/testing",
			items: [
				{
					title: "Hardware-in-the-Loop (HIL)",
					href: "/docs/testing/hil",
					items: [],
				},
				{
					title: "Expect Assertion API",
					href: "/docs/testing/expect",
					items: [],
				},
				{
					title: "Source-Mapped Diagnostics",
					href: "/docs/testing/source-mapped-diagnostics",
					items: [],
				},
			],
		},
```

### Task 3.6: Restructure `docs/ecosystem/+page.md`

This page cannot be merely renamed — it lists four **deleted** packages (`@typehal/core`, `@typehal/transpiler`, `@typehal/create`, `@typehal/schema`) and shows a `defineConfig` flow that no longer exists. It needs a structural rewrite.

**Files:**
- Modify: `website/src/routes/docs/ecosystem/+page.md` (full rewrite)

- [ ] **Step 1: Replace the entire file contents with:**

````markdown
# Ecosystem & Configuration

Tools for creating projects, defining boards, and using the CLI.

---

## Topics

| Topic | What you'll learn |
|-------|-------------------|
| [Project Scaffolding](/docs/ecosystem/project-scaffolding) | Create new Cuttlefish projects with `cuttlefish create` |
| [Board Definitions](/docs/ecosystem/board-definitions) | Use or create board definition packages |
| [Contracts](/docs/ecosystem/contracts) | Use typeCAD contracts for custom hardware |
| [CLI Reference](/docs/ecosystem/cli-reference) | Full command-line reference for `cuttlefish` |

## Package Ecosystem

| Package | Purpose |
|---------|---------|
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

## Quick Start

Create a new project in one command:

```bash
npx cuttlefish create my-project --target arduino-uno
cd my-project
npm install
npm run compile
```

Available targets for `--target`: `native` (desktop), `arduino-uno`, `esp32-devkit`, `esp32s3`. Run `cuttlefish create` with no `--target` for an interactive wizard.

## Project Configuration

Each Cuttlefish project has a `cuttlefish.config.ts` that defines the entry point, target architecture, MCU, board, framework, and output settings. This file is auto-generated by the scaffolder but can be customized:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/sketch.ts',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  frameworkData: {
    buildTarget: 'esp32:esp32:esp32',
  },
  output: {
    framework: 'arduino',
    optimize: 'size',
    outDir: './out',
  },
};

export default config;
```

Key fields:
- **`entry`** — the TypeScript (or `.ui`) entry point.
- **`target`** — architecture: `avr`, `esp32`, `esp32s3`, or `native`.
- **`mcu`** — the silicon-level pin/port definitions package (e.g. `@typecad/mcu-esp32`).
- **`board`** — the board-level pin aliases and peripheral mappings (e.g. `@typecad/board-esp32-devkit`).
- **`framework`** — the code-generation strategy package.
- **`frameworkData.buildTarget`** — the FQBN passed to `arduino-cli`.
- **`output`** — `framework` (matching the strategy), `optimize` (`size`/`speed`), `outDir`.

Use **`board`** for standard development boards, or **`mcu`** + **`contract`** for custom PCBs designed in typeCAD (see [Contracts](/docs/ecosystem/contracts)).

## Build Commands

The typical workflow uses these npm scripts (auto-generated in `package.json`):

```bash
npm run build     # Transpile to C++
npm run compile   # Transpile + compile
npm run upload    # Transpile + compile + upload
npm run monitor   # Open serial monitor
```

Or use the CLI directly:

```bash
cuttlefish build --compile --upload --port COM4
cuttlefish build --watch --compile    # Auto-rebuild on changes
cuttlefish build --diagnostics        # Generate diagnostics report
```

See [CLI Reference](/docs/ecosystem/cli-reference) for all commands and flags.
````

### Task 3.7: Rewrite `docs/ecosystem/cli-reference/+page.md`

**Files:**
- Modify: `website/src/routes/docs/ecosystem/cli-reference/+page.md` (full rewrite)

- [ ] **Step 1: Replace the entire file contents with:**

````markdown
# CLI Reference

The `cuttlefish` command-line tool transpiles TypeScript to C++, manages projects, and interfaces with hardware toolchains. Hardware tests use the separate `cuttlefish-test` binary (see [Testing](/docs/testing/expect)).

## `cuttlefish <input.ts> [options]`

Transpile a TypeScript file to C++. Transpilation is always performed first.

```bash
cuttlefish src/sketch.ts --emit cpp --outDir out
```

| Option | Description |
|--------|-------------|
| `--emit <mode>` | `cpp` (single file) or `split` (separate `.cpp`/`.h`). Default: `split`. |
| `--target <platform>` | Target platform string (default: `generic`). |
| `--outDir, --out-dir <path>` | Output directory (default: input file directory). |
| `--emit-maps <bool>` | Emit source maps (`true`/`false`, default: `true`). |

## `cuttlefish build [options]`

Build using the entry point from `cuttlefish.config.ts`.

```bash
cuttlefish build --compile --upload --port COM4
```

Build options chain in order: `--compile` → `--upload` → `--monitor`:

| Option | Description |
|--------|-------------|
| `--compile` | Compile generated output via the framework toolchain. Requires a build target. |
| `--upload` | Upload firmware to the board. Requires `--compile` and `--port`. |
| `--monitor` | Open an interactive serial monitor after upload. Requires `--port`. |
| `--expect [file]` | Run hardware tests via `@typecad/expect` (discover and validate over serial). For the full-featured runner, prefer `cuttlefish-test`. |
| `--build-target <id>` | Framework-specific build target / FQBN (e.g. `arduino:avr:uno`, `esp32:esp32:esp32`). |
| `--port <port>` | Serial port (`COM4`, `/dev/ttyACM0`). |
| `--baud <rate>` | Baud rate for `--monitor` (default: `9600`). |
| `--framework <pkg>` | Framework package override (e.g. `@typecad/framework-arduino`). |
| `--watch, -w` | Watch for file changes and retranspile. Incompatible with `--monitor`. |
| `--diagnostics` | Generate `diagnostics.md` and `diagnostics.json` (IR graph, heap, task analysis). |

### Tree-shaking options

| Option | Description |
|--------|-------------|
| `--no-tree-shake` | Disable dead-code elimination. |
| `--keep-unused-enums` / `--keep-unused-classes` / `--keep-unused-types` / `--keep-unused-variables` | Retain specific unused symbols. |
| `--entry-point <name>` | Add a custom entry-point symbol (repeatable). |

## `cuttlefish create [name] [options]`

Create a new Cuttlefish project. Runs an interactive wizard if no `--target` is given.

```bash
cuttlefish create my-project --target arduino-uno
```

| Option | Description |
|--------|-------------|
| `--target, -t <id>` | Target: `native`, `arduino-uno`, `esp32-devkit`, `esp32s3`. |
| `--board, -b <id>` | Alias for `--target`. |
| `--framework, -f <pkg>` | Framework: `arduino`, `avr`, `native`. |
| `--baud <rate>` | Serial baud rate (default: `9600`). |
| `--no-sketch` | Skip generating the starter sketch. |
| `--outDir, -o <path>` | Output directory (default: `./<name>`). |

## `cuttlefish preview [--config <path>] [--port <port>]`

Start a browser preview of the configured UI display. Uses `cuttlefish.config.ts` by default.

## `cuttlefish map-error <mapFile> [options]`

Map a C++ error location back to TypeScript source.

```bash
cuttlefish map-error out/sketch.ino.thcppmap.json --line 42 --column 10 --message "error: 'foo' was not declared"
```

| Option | Description |
|--------|-------------|
| `--line, --cpp-line <n>` | **Required.** C++ line number. |
| `--column, --cpp-column <n>` | C++ column (default: `1`). |
| `--cpp-file <path>` | C++ file path. |
| `--message <text>` | Error message. |

## `cuttlefish gen-decls <file.cpp|--all <dir>>`

Generate TypeScript `.d.ts` declarations from C++ headers.

```bash
cuttlefish gen-decls src/sensor.h
cuttlefish gen-decls --all ./vendor/include
```

## `cuttlefish gen-libdefs <input.ts>`

Generate library definitions from a TypeScript file's imports.

```bash
cuttlefish gen-libdefs src/sensor.ts
```

## Common workflows

```bash
cuttlefish build --compile --board @typecad/board-arduino-uno
cuttlefish build -w --compile --upload --port COM4
cuttlefish build --diagnostics
cuttlefish create my-esp32 --target esp32-devkit
```

For hardware tests, use the dedicated `cuttlefish-test` binary — see [Expect Assertion API](/docs/testing/expect).
````

### Task 3.8: Sweep `docs/ecosystem/project-scaffolding/+page.md`

**Files:**
- Modify: `website/src/routes/docs/ecosystem/project-scaffolding/+page.md`

- [ ] **Step 1: Read the file and apply these changes.**

The page documents the old `npx @typehal/create` / `typehal init` flow with `defineConfig`. Update it to the current `cuttlefish create` flow with typed-config.

Replacements:
- `npx @typehal/create my-project --board arduino-uno` → `npx cuttlefish create my-project --target arduino-uno`
- `npx @typehal/create` (bare) → `cuttlefish create` (bare)
- `typehal init my-project --board arduino-uno` → `cuttlefish create my-project --target arduino-uno`
- `@typehal/framework-arduino` → `@typecad/framework-arduino`
- All `--board` flags on `create`/`init` → `--target` (the current canonical flag)
- The `defineConfig` blocks — replace both occurrences (lines ~77 and ~95) with the typed-config pattern shown in Task 3.6. Specifically:

  Replace:
  ```ts
  import { defineConfig } from '@typehal/core';

  export default defineConfig({
    entry: './src/sketch.ts',
    target: 'avr',
    board: '@typehal/board-arduino-uno',
    framework: '@typehal/framework-arduino',
    // ...
  });
  ```
  with:
  ```ts
  import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

  const config: CuttlefishConfig = {
    entry: './src/sketch.ts',
    target: 'avr',
    board: '@typecad/board-arduino-uno',
    framework: '@typecad/framework-arduino',
    frameworkData: { buildTarget: 'arduino:avr:uno' },
    output: { framework: 'arduino', optimize: 'size', outDir: './out' },
  };

  export default config;
  ```

  And the second `defineConfig` block (the `mcu` variant, line ~95) becomes:
  ```ts
  import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

  const config: CuttlefishConfig = {
    entry: './src/sketch.ts',
    target: 'avr',
    mcu: '@typecad/mcu-atmega328p',
    framework: '@typecad/framework-arduino',
    frameworkData: { buildTarget: 'arduino:avr:uno' },
    output: { framework: 'arduino', optimize: 'size', outDir: './out' },
  };

  export default config;
  ```

- Update the file-tree caption `typehal.config.ts` → `cuttlefish.config.ts` and `typehal-env.d.ts` → `cuttlefish-env.d.ts` (lines ~59-60).
- Update the `### `typehal.config.ts`` heading (line ~73) → `### `cuttlefish.config.ts``.
- Replace prose mentions of "TypeHAL project" → "Cuttlefish project" (line ~3) and "TypeScript config for TypeHAL" → "TypeScript config for Cuttlefish" (line ~58).

### Task 3.9: Sweep `docs/ecosystem/contracts/+page.md`

This page has many hits, including the ambient `@typehal` module, `TypehalConfig`, `typehalManifest`, and `.typehal/board.ts`.

**Files:**
- Modify: `website/src/routes/docs/ecosystem/contracts/+page.md`

- [ ] **Step 1: Read the file and apply these changes.**

Mechanical swaps (apply throughout):
- `@typehal/` → `@typecad/` (covers `@typehal/mcu-atmega328p`, `@typehal/framework-arduino`, `@typehal/hal`)
- bare `'@typehal'` (ambient module) → `'@typecad'`
- `typehal.config.ts` → `cuttlefish.config.ts` (lines ~90, ~221, ~258)
- `.typehal/board.ts`, `.typehal/board` → `.cuttlefish/board.ts`, `.cuttlefish/board` (lines ~134, ~137, ~162, ~179)
- `typehal-env.d.ts` → `cuttlefish-env.d.ts` (lines ~173, ~175)
- `typehal build --compile --upload` → `cuttlefish build --compile --upload` (line ~230)
- `typehal build --mcu` → `cuttlefish build --mcu` (line ~247)
- "typeCAD hardware designs with typeHAL firmware" → "typeCAD hardware designs with Cuttlefish firmware" (line ~3, ~141)
- "Integrating with a typeHAL Project" → "Integrating with a Cuttlefish Project" (line ~86)
- "in typeHAL" → "in Cuttlefish" (lines ~203, ~207, ~217, ~229)
- `TypehalConfig` → `CuttlefishConfig` (lines ~93, ~95), and change the import from `@typehal/core` to `@typecad/cuttlefish/api`:
  ```ts
  import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

  const config: CuttlefishConfig = {
    // ...
    mcu: '@typecad/mcu-atmega328p',
    contract: './src/board.contract.json',
    framework: '@typecad/framework-arduino',
    // ...
  };
  ```
- `typehalManifest` → `TypeCADManifest` (lines ~252, ~254) — the actual current export name is `TypeCADManifest` (verified at `packages/mcu-esp32/src/index.ts:279`), not `cuttlefishManifest`. Update the prose and the quoted error message accordingly.

- [ ] **Step 2: Verify.**

`grep -ni "typehal" website/src/routes/docs/ecosystem/contracts/+page.md` → no hits.

### Task 3.10: Sweep `docs/ecosystem/board-definitions/+page.md`

**Files:**
- Modify: `website/src/routes/docs/ecosystem/board-definitions/+page.md`

- [ ] **Step 1: Apply mechanical swaps.**
- `@typehal/board-arduino-uno` → `@typecad/board-arduino-uno`
- `@typehal/board-esp32-devkit` → `@typecad/board-esp32-devkit`
- `typehal create-board my-custom-board` → `cuttlefish create my-custom-board` (line ~63) — note the `create-board` subcommand was removed; `cuttlefish create` is the replacement. If the surrounding prose describes board-scaffolding flow that no longer exists, soften it to point users to the `@typecad/create` workflow or the board-definition package structure rather than a dead command.
- "integrating typeCAD hardware designs with typeHAL firmware" → "…with Cuttlefish firmware" (line ~141)

### Task 3.11: Verify Phase 3 and commit

- [ ] **Step 1: Confirm the whole site is clean.**

```bash
grep -rni "typehal" website/src/routes website/src/lib | grep -v "routes/news/"
```
→ must show **zero hits**. (News posts may retain bare prose `typeHAL`/`TypeHAL` mentions per Task 1.6's rule, but those are `TypeHAL` capitalizations, not `typehal` lowercase — this grep is case-insensitive so it will catch them. If it returns only news-post prose hits, those are acceptable; verify each is a prose product-name mention and not a command/import.)

If you want a stricter check excluding the allowed news-post prose:
```bash
grep -rni "typehal" website/src/routes website/src/lib | grep -v "routes/news/" | grep -vi "@typehal\|npx typehal\|typehal build\|typehal init\|typehal create\|typehal\.config\|\.typehal"
```
→ zero hits (this allows news posts to keep lowercase `typehal` only inside prose sentences).

- [ ] **Step 2: Run svelte-check.**

```bash
npm run check --workspace website
```
Expected: passes.

- [ ] **Step 3: Run the build.**

```bash
npm run build --workspace website
```
Expected: succeeds, no route 404s, every `.md` (including the new `docs/testing/expect` page) compiles.

- [ ] **Step 4: Commit.**

```bash
git add website/src/routes/docs/testing/ \
        website/src/routes/docs/ecosystem/ \
        website/src/lib/config/docs.ts
git commit -m "docs(website): rewrite expect/testing docs + restructure ecosystem

Rewrites the testing section for @typecad/expect and the cuttlefish-test
binary (section index, HIL page, new expect/ assertion-API page). Sweeps
source-mapped-diagnostics for the cuttlefish CLI. Restructures the
ecosystem page to drop the four deleted packages (@typehal/core,
transpiler, create, schema), add the seven current packages the table
was missing, fix the config shape (typed CuttlefishConfig, separate
mcu/board fields), and update the scaffolding command (cuttlefish
create --target). Rewrites cli-reference for the actual cuttlefish
subcommand surface. Sweeps the remaining @typehal tokens in contracts,
project-scaffolding, and board-definitions. Completes the parity work."
```

---

## Final verification (after all three phases)

- [ ] **Step 1: Full grep audit.**

```bash
grep -rni "typehal" website/src/routes website/src/lib
```
The only acceptable remaining hits are bare prose product-name mentions (`typeHAL`/`TypeHAL`) inside `website/src/routes/news/*.md` bodies. Confirm each is prose, not a command or import.

- [ ] **Step 2: Build the whole site.**

```bash
npm run build --workspace website
```
Expected: succeeds. All routes — including the five new `docs/ui/*` pages and the new `docs/testing/expect` page — compile without 404s.

- [ ] **Step 3: Spot-check navigation.**

Confirm the sidebar (`docs.ts`) has:
- "User Interface (Cuttlefish UI)" group with four children, between Transpiler and Simulation.
- "Testing & Diagnostics" group with three children (HIL, Expect Assertion API, Source-Mapped Diagnostics).

- [ ] **Step 4: Spot-check the home page.**

The hero reads `Cuttlefish` and the tagline reads `TypeScript + Embedded Safety = Cuttlefish`. The typeCAD/`typecad.net` branding is intact.

Done. The website is at parity with the renamed `@typecad/cuttlefish` transpiler and the `@typecad/ui` and `@typecad/expect` features.
