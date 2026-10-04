# typeCAD/hal — VS Code extension

The VS Code extension for [typeCAD/hal](https://typecad.dev) embedded
projects. It is **not** published to the Marketplace — `typecad-hal create`
vendors the built extension into every project's `.vscode/extensions/` (with
a `forceInstall` entry in `.vscode/extensions.json`), so projects get the
full editor experience with zero manual install. The monorepo refreshes
every vendored copy with `npm run sync:typecad-ui`.

One extension, three surfaces (the merge of the former `typecad-ui`,
`vscode-typecad-debug`, and `vscode-typecad-intel` extensions — command ids
keep their historical `typecad-debug.*` / `typecad-intel.*` prefixes):

- [`.ui` language support](#ui-language-support-declarative--no-runtime)
- [Board-aware intelligence](#board-aware-intelligence) — diagnostics, hovers, quick-fixes, chips, status bar
- [Declaration generation](#declaration-generation) — C++ → TypeScript declarations

---

## .ui language support (declarative — no runtime)

Syntax highlighting and editor support for `.ui` single-file components:
TypeScript in `<script>`, CSS in `<style>`, and Svelte-style markup
(`on:click={handler}`, `{expression}` interpolations), by embedding VS
Code's builtin grammars.

- **Snippets** for the `.ui` idioms — type the prefix and Tab: `screen`,
  `button`, `bind`, `signal`, `canvas`, `list`, …
- **Markdown injection** — ` ```ui ` fenced code blocks highlight in docs.
- **File icons** for `.ui` files (shown when the active icon theme has no
  mapping of its own).

See `ui-language/ATTRIBUTION.md` for the grammar's provenance (adapted from
sveltejs/language-tools, MIT).

## Board-aware intelligence

Live, board-aware diagnostics and hovers with **no build running**. On every
save (and whenever the config, `typecad-hal.facts.json`, or the generated
board module changes) the extension analyzes the project in no-emit mode
through the project's *own* `@typecad/cuttlefish` copy — the same engine
that builds it — so editor diagnostics can never drift from build
diagnostics.

- **Problems panel** — every diagnostic from every file in the import graph
  (pin capability errors, alias conflicts, peripheral ownership, try/catch on
  no-exception targets, …), each mapped onto the real editor range in the
  file it refers to. Severity icons match the CLI's.
- **Quick-fixes (the lightbulb)** — diagnostics can carry an executable fix:
  - Pin-capability errors ("PA0 does not support PWM on this board") offer a
    swap to the first pin that does — applied at pin-argument construction
    sites only, never a blanket rename.
  - Ownership diagnostics offer token-precise rewrites: "Borrow by
    reference" (promote the storage keyword and annotate the destination
    `: Shared`) and "Make 'x' const" promotion. Every edit verifies the
    document still says what the analysis saw, so drifted files skip
    cleanly instead of being mangled.
- **Hovers** beyond plain TypeScript tooling:
  - Your own bindings: `const adc = new ADC(PA0)` reads "ADC — on PA0" with
    the pin's harvested routes; pin aliases (`const led = LED`) and devices
    on board buses (`I2C0.device(0x48)`) likewise.
  - Gated classes carry their wiring facts: `Store`/`File` show the storage
    region (size, flash offset, origin), `Counter` the free hardware
    counters, `Watchdog` its wiring.
  - `SENSOR('bme688')` tokens resolve against the part catalog — compatible
    string, buses, channels.
  - Pins the program claims show how they're used: "In this project:
    ANALOG (ADC 0)".
  - The board module's own exports (pins, buses) carry their harvested
    facts as JSDoc, so tsserver hover and completions are board-aware even
    without this extension.
- **Inline fact chips** — construction lines get an after-line chip naming
  the argument's resolved datasheet pin and what it can do: `new GPIO(LED, …)`
  shows `⌁ PC13`, `new ADC(PA0)` shows `⌁ PA0 · PWM pwm2 ch1 · ADC adc1 ch0
  · aliases: BUTTON` (the alias echoing the written identifier is stripped).
  Chips track unsaved edits and skip strings, template literals, and
  comments.
- **Status bar** — board name and error/warning counts (`blackpill_f401cc ·
  0E 1W`); hover for the memory estimate (static bytes, stack depth), async
  task and ISR counts, and timer usage; click to re-analyze. Missing engine
  or config shows an actionable hint instead of stale results.
- **Device commands** — the entry file carries a `▶ Flash & Monitor`
  CodeLens, test files carry `⚡ Run on Hardware`; both run in a shared
  "TypeCAD" terminal.
  - The serial port is picked from attached USB devices (manufacturer,
    VID:PID shown), with manual entry fallback.
  - The choice is cached for the session but re-validated on every use — a
    port that disappeared (board moved, new COM number) re-opens the picker
    instead of flashing a ghost. **TypeCAD: Select Serial Port** forces a
    re-pick at any time.

## Declaration generation

- **C++ → TypeScript declarations** — saving a `.cpp` file auto-generates a
  `.d.ts` sidecar when one is missing (never clobbers); the explicit command
  generates for the active file and opens it.

### Source-level debugging

Breakpoint debugging is VS Code's native debugger over GDB: press **F5** in a
project whose board carries a debug-capable probe method (openocd/jlink in
its facts). The engine writes `launch.json` + `tasks.json` at create/build
time; the build task compiles and flashes with `--debug`, then the debug
server serves GDB on port 3333. On boards without a debug-capable probe,
`--debug` fails with an explicit diagnostic — print-state debugging via the
serial console (`USB0.writeLine(...)` / `UART0.writeLine(...)`) works on
every board.

### Commands

| Command | Title |
|---|---|
| `typecad-intel.reanalyze` | TypeCAD: Re-analyze Project |
| `typecad-intel.flashMonitor` | TypeCAD: Flash & Monitor |
| `typecad-intel.runTests` | TypeCAD: Run Tests on Hardware |
| `typecad-intel.selectPort` | TypeCAD: Select Serial Port |
| `typecad-debug.generateDeclaration` | TypeCAD: Generate Declaration from C++ |

## Build

```sh
cd packages/vscode-typecad-hal
npm install
npm run compile
npm run package      # produces vscode-typecad-hal-0.3.0.vsix
```

License: Apache-2.0 (the bundled .ui grammar carries its own MIT
attribution in `ui-language/ATTRIBUTION.md`).
