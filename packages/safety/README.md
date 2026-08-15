# @typecad/safety

cuttlefish safety mechanisms — verified GPIO reads and fault reporting for
embedded projects that need more than best-effort I/O.

## What's inside

- **`src/index.ts`** — public API (safe types, verified reads)
- **`src/asil-decorators.ts`** — ASIL-oriented decorators
- **`src/safe-int-types.ts`** / **`src/safe-variable-types.ts`** —
  overflow-checked numeric types
- **`src/safety-hook.ts`** — fault hook types (also exported as
  `@typecad/safety/safety-hook-types`)
- **`src/engine-index.ts`** — static-analysis engine entry (also exported as
  `@typecad/safety/engine`)
- **`src/passes/`**, **`src/iso26262/`**, **`src/runtime/`**, **`src/hal/`** —
  analysis passes, ISO 26262 mappings, runtime support

## Related packages

- [`@typecad/hal`](../hal) — hardware abstraction layer
- [`@typecad/cuttlefish`](../cuttlefish) — transpiler and CLI

## License

MIT
