# Safety engine (built into @typecad/cuttlefish)

cuttlefish safety mechanisms — verified GPIO reads and fault reporting for
embedded projects that need more than best-effort I/O.

This module was merged into `@typecad/cuttlefish` from the former
`@typecad/safety` package. The authoring surface is importable as
`@typecad/cuttlefish/safety`; the legacy `@typecad/safety` specifier is
still detected by the transpiler (detection is by name — the module is
never resolved).

## What's inside

- **`authoring.ts`** — public API (safe types, verified reads), exported as
  `@typecad/cuttlefish/safety`
- **`engine.ts`** — safety engine entry; registered by `safety-bridge.ts`
- **`specifiers.ts`** — the import specifiers that activate safety
- **`asil-decorators.ts`** — ASIL-oriented decorators
- **`safe-int-types.ts`** / **`safe-variable-types.ts`** —
  overflow-checked numeric types
- **`safety-hook.ts` (at `src/safety-hook.ts`)** — the hook contract
  (exported as `@typecad/cuttlefish/safety-hook-types`)
- **`passes/`**, **`iso26262/`**, **`runtime/`**, **`hal/`** —
  analysis passes, ISO 26262 mappings, runtime support

## Related packages

- [`@typecad/hal`](../../hal) — hardware abstraction layer
- [`@typecad/cuttlefish`](../..) — transpiler and CLI
