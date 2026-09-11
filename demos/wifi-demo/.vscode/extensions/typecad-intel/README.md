# TypeCAD Intel

Board-aware language intelligence for TypeCAD firmware projects — bundled
into every project scaffolded by `typecad-hal create`, so it works with zero
install on VS Code 1.89+ (workspace-bundled extensions, `forceInstall`).

## What it does

- **Live Problems-panel diagnostics without a build.** On every save (and
  whenever `typecad-hal.config.ts` or the generated board module moves) it
  runs the project's own `@typecad/cuttlefish` engine in no-emit mode — the
  same graph walk, IR build, and validation suite as `typecad-hal query`:
  pin capability errors, alias conflicts, pin-mode problems, peripheral
  ownership, try/catch on no-exception targets, and more, mapped onto real
  editor ranges. The `typecad-hal: watch build` task stays available as the
  streaming full-build alternative.
- **Quick-fixes for engine-suggested fixes.** When the engine flags a pin
  that lacks a capability, it computes the first pin on the board that
  supports the operation — the lightbulb offers a one-click
  "Use PA0 instead of PB10" swap at the construction site (pin-argument
  positions only). Ownership diagnostics carry executable fixes too:
  "Borrow by reference: const archived: Shared = packet" rewrites the
  declaration (storage keyword + `: Shared` annotation, your trailing
  comment untouched) and "Make 'x' const" promotes a never-reassigned
  `let`. Position-based edits verify the expected text before applying, so
  a document edited since the last analysis self-skips drifted pieces
  rather than mangling the line. Applying a fix clears its squiggle
  immediately; the disk-based analysis re-derives everything on the next
  save.
- **Board-aware hovers on your own variables.** Hovering a pin export
  (`PA0`) shows its facts through plain tsserver (the board module carries
  them as JSDoc). This extension additionally resolves:
  - your *bindings* — `const adc = new ADC(PA0)` → "ADC — on PA0" with the
    pin's routes; `const s = PA0` → the pin alias; `const therm =
    I2C0.device(0x48)` → the board bus with its pad map
  - gated HAL classes — `Store`/`File` → the storage region, `Counter` →
    the free hardware counters, `Watchdog` → its devicetree node
  - `SENSOR('…')` tokens — part description, compatible, buses, channels
    from the 215-part catalog in the project's own hal copy
  - program facts — pins your code claims show "In this project: ANALOG
    (ADC 0)" beneath the board facts (joined from the last analysis)

  A word inside string text or a comment is not an identifier —
  `` USB0.writeLine(`adc: ${adc.read()}`) `` hovers only the `adc` inside
  the interpolation, not the one in the message text (sensor tokens inside
  quotes hover by design).
- **Inline fact chips.** Construction lines carry an after-line chip naming
  the argument's resolved datasheet pin plus what it can do that the code
  doesn't say: `const led = new GPIO(LED, GPIO.OUTPUT)` renders `⌁ PC13`
  (aliases resolve to the datasheet pin), `const adc = new ADC(PA0)`
  renders `⌁ PA0 · PWM pwm2 ch1 · ADC adc1 ch0 · aliases: BUTTON`, and
  `I2C0.device(0x48)` lines render the bus's pad map. The alias that just
  echoes the written identifier is stripped; constructions that spell a
  bare pin's name stay undecorated; the chips track unsaved edits and
  regenerate when the board module does.
- **Flash & Monitor / Run on Hardware.** The entry file carries a
  `▶ Flash & Monitor` CodeLens (transpile → compile → upload → serial
  monitor in one shot) and test files carry `⚡ Run on Hardware` — both run
  in the shared "TypeCAD" terminal. The serial port is picked once per
  session from the attached USB devices (quick pick with VID/PID and
  manufacturer; falls back to manual entry when none are attached), and the
  commands are also in the palette.
- **A status bar that knows your board.** `<board> · NE NW` with the
  analyzed counts; the tooltip adds the memory estimate and task inventory
  (`~N B static · stack depth N · N async · N ISR · timers on`). Click to
  re-analyze (or run `TypeCAD: Re-analyze Project`).

## How it works

The extension is a thin shell: it resolves `@typecad/cuttlefish` from the
**project's** `node_modules` and calls its `./language-server` subpath
(`analyzeForEditor`). The editor therefore always analyzes with the exact
engine version that builds the project — no bundled engine, no version
drift. Analysis runs on save because the engine reads files from disk;
unsaved buffer state is not visible to it.

Pin capability facts also ship in the generated `.typecad-hal/board.ts` as
JSDoc on pin exports (`/** PWM tim4 ch1 · aliases: D0 */`), so hover and
completions are board-aware in plain TypeScript tooling too.

## Graceful degradation

- Engine not installed → status-bar hint; re-analyze after `npm install`.
- No `typecad-hal.config.ts` entry → status-bar hint.
- Any engine error → shown in the status bar tooltip; the extension never
  takes the extension host down.

## Limitations

- Single-folder workspaces (the first folder is analyzed).
- Diagnostics reflect the last saved state of each file, not keystrokes.
