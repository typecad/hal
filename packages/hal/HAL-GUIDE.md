# Adding HAL Features

This guide explains how `@typecad/hal` features work and how to add a new
one. The HAL source files live in `packages/hal/src/` and are read by the
transpiler's resolver at build time — HAL classes have no runtime; they are
declarations the transpiler interprets.

## Core principle

**Every method lowers through a semantic op, or it doesn't happen.** A HAL
method body calls a stub function from `emit.ts`; the transpiler turns that
call into a `HALOpIR` node; the active framework's strategy lowers the node
to C++. There are no inline C++ fallbacks in the HAL and no runtime
implementations of the stubs — the stubs exist so TypeScript compiles and
the resolver has a hook to intercept.

`rawCpp(text)` remains the escape hatch for code that IS the implementation
(a one-line wrapper around a kernel API that needs no per-target decision),
but new hardware domains should use the op pipeline: it is what the
framework manifest declares, what the board facts gate, and what the
hal-resolution snapshot tests cover.

## The pipeline

```
packages/hal/src/<class>.ts        class + constructor facts (this._field = param)
        │  method body calls…
packages/hal/src/emit.ts           zero-body stub: export function gpioWrite(...) {}
        │  transpiler intercepts the call…
packages/cuttlefish/src/ir/hal/hal-plugins.ts     case "gpioWrite": → { operation: "gpio.write", … }
        │  produces a typed node…
packages/cuttlefish/src/api/shared/hal-op-ir.ts   interface GpioWriteOp { operation: "gpio.write"; … }
        │  framework strategy resolves it…
packages/framework-zephyr/src/lowering/gpio.ts    case 'gpio.write': → C++
packages/framework-zephyr/src/framework.manifest.ts  declares the op supported
```

Availability is a **board fact**, not a code branch: for classes that need
silicon facts (PWM, ADC, DAC, buses, USB, Store/File, Watchdog, Counter),
`boardgen.ts` emits constants from the Zephyr board catalog, the generated
`@typecad/board` module re-exports the class only when the facts support
it, and importing unavailable hardware fails at module resolution.

## Class anatomy

Construction carries the facts — the resolver reads the exact pattern
`this._field = param` to build a field map, and later resolves instance
calls against the captured values:

```ts
// gpio-pin.ts (real)
export class GPIO {
  private readonly _pin: number;
  private readonly _flags: number;

  constructor(pin: number | Pin, flags: number) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._flags = flags;
  }

  toggle(): void {
    gpioToggle(this._pin);        // emit.ts stub → hal-plugins case → gpio.toggle op
  }
}
```

- **Fields** — `private` + underscore prefix; referenced in stub arguments
  so values captured at construction (`new GPIO(LED, GPIO.OUTPUT)`) flow to
  the op.
- **Parameters** — plain arguments; defaults (`opts?.x ?? v`) are recorded
  and re-applied by the plugin when the call site omits them.
- **`include(header)`** — call from a method (or constructor) to register a
  deduplicated `#include`.
- **Tokens** — static class constants (`GPIO.OUTPUT`,
  `ADC.GAIN_1_6`) map to C++ macros in the plugin/lowering; the
  `zephyr-tokens.generated.ts` tables are parsed from the pinned tree's
  headers so the set cannot drift from upstream.

Chaining works with the `this` pattern (`return this;`) and with
intermediate chain classes that share field names — the resolver propagates
fields to a returned instance. `BLE`/`BleChain` (ble.ts) is the reference
implementation; see `README_FLUENT_API.md`.

## Adding a new peripheral — checklist

1. **Class** — `packages/hal/src/<name>.ts`: constructor facts + one method
   per verb. Re-export from `index.ts`. (Source discovery is dynamic —
   every `.ts` in `src/` except `index.ts` is parsed; there is no file
   list to edit.)
2. **Stubs** — `packages/hal/src/emit.ts`: one zero-body function per verb.
3. **Op interfaces** — `packages/cuttlefish/src/api/shared/hal-op-ir.ts`:
   one interface per verb, added to the `HALOpIR` union and the
   `HAL_OPERATION_KINDS` registry (an exhaustive check fails the build if
   they drift).
4. **Plugin cases** — `packages/cuttlefish/src/ir/hal/hal-plugins.ts`:
   resolve stub args into the op (this is where field values, defaults, and
   token mapping land). Unknown token spellings should throw naming the
   valid set.
5. **Lowering** — `packages/framework-zephyr/src/lowering/<name>.ts` + a
   route in `lowering/index.ts`; declare every op in
   `framework.manifest.ts` (the validator probes the resolver and fails on
   a declaration that doesn't lower, and vice versa).
6. **Board facts (when hardware-gated)** — if availability depends on
   silicon, emit the fact from `boardgen.ts` (harvested by
   `packages/cuttlefish/src/board-catalog/`), resolve it in
   `chips/resolve.ts`, gate the class re-export in the board module, and
   bump `GENERATOR_REV` when extraction changes. Never branch on board
   names — the facts are the difference between boards.
7. **Tests** — a snapshot test in
   `tests/packages/framework-zephyr/hal-resolution/` (one file per
   category, asserting the exact C++ each op lowers to), plus a hardware
   group in `packages/hal/tests/` driven by `test-pins.json` roles so
   boards without the hardware skip cleanly.

## Reference implementations

- `gpio-pin.ts` / `pwm-pin.ts` — minimal fact-carrier classes.
- `adc-pin.ts` — token tables + per-controller device selection.
- `uart-port.ts` — multi-op method bodies (println = two writes).
- `thread.ts` / `counter.ts` — callback registration through `callback()`.
- `wifi.ts` / `http.ts` — the largest semantic-op surfaces.
- `ble.ts` — the chain pattern.

## Directives

| Directive | Effect |
| --- | --- |
| `include(h)` | Deduplicated `#include` in the output. |
| `rawCpp(text)` | Append a line of C++ (field/parameter substitution) — the escape hatch. |
| `rawCppExpr(text)` | The same, in expression position. |
| `board(path)` | Resolve a board-fact constant inside a template. |
| `callback(fn)` | Register a function value for handler-taking APIs. |
