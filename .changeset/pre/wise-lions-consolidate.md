---
'@typecad/cuttlefish': minor
'@typecad/hal': minor
'@typecad/framework-zephyr': minor
---

Consolidate the package graph: expect and simulator dissolve into hal + the engine.

- The engine no longer depends on `@typecad/hal` — HAL sources and the
  board-gate lists resolve from the project's own hal install
  (`TYPECAD_HAL_DIR` overrides), with a lockstep version warning on skew.
  `@typecad/hal` now depends on `@typecad/cuttlefish` (the product composes
  the engine); `@typecad/framework-zephyr` drops its hal dependency.
- The hardware-test DSL ships in hal (`@typecad/hal/testing`); the host
  runner is built into the CLI (`cuttlefish test`, `cuttlefish-test` alias)
  and resolves the build framework from the project config instead of
  hardcoding framework-zephyr.
- The simulator ships in hal (`@typecad/hal/sim`); a device build importing
  it fails with a pointing diagnostic.
- Board-gate export lists are derived (index exports minus `GATED_EXPORTS`)
  instead of hand-maintained; new hal value exports self-classify.
- Scaffolds list exactly `@typecad/hal` + the framework at the engine's own
  version (no more stale hardcoded ranges, and the `undefined` dependency
  bug fails loudly at scaffold time).
