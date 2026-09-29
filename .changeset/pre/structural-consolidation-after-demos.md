---
'@typecad/cuttlefish': patch
---

Structural consolidation of the failure patterns the two demo rounds
(climate-fan, bench-supervisor) surfaced — four root causes, four
single-source-of-truth fixes; no behavior changes on green paths:

- **Helper return-type registry** (`api/shared/helper-return-types.ts`): the
  `__tc_*` return classification (string / bool / int / double / vector)
  lives in ONE table. The three parallel regex arms of the expression
  renderer's type inference (method-call, call, raw) now consult it —
  previously every new helper needed an entry in all three, and
  `__tc_num_radix` shipped missing from every one (a `toString(16)`
  interpolation printed a pointer through %d). A completeness test pins
  "every helper the polyfill registry can emit has a return-type entry."
- **One map-key enum cast** (`ir/map-key-cast.ts`): the enum-key→container
  key-type cast existed as three diverged copies (the Map-method lowering,
  the statement path's castEnumKeyIfNeeded, and the `??` nullish lowering);
  they disagreed on key-type coverage, so `Map<number, V>` (double keys)
  never cast enum keys on one path. All three consult the shared function,
  which covers enum members, bare enum-typed identifiers, and enum-typed
  instance fields (`cmd.verb`).
- **Header linkage invariants** (`emit/emitters/header-linkage-check.ts`):
  a post-emit check over the final split-mode header lines, failing the
  build at emit time instead of at link time on target hardware. Flags
  non-inline free-function definitions in headers (every including TU
  defines them — the polyfill multiple-definition class) and prototypes
  that trail the class definitions while an inline class body above calls
  them (the "not declared in this scope" class). `friend` declarations
  count as visibility, not calls, so post-class ISR-shim prototypes stay
  legal.
- **Symbol table carries interfaces**: `buildSymbolTable`/`mergeSymbolTable`
  now aggregate top-level interface names alongside classes, functions, and
  variables — the cross-module interface registry is part of the one
  aggregated table rather than a standalone scan, so the next cross-module
  interface consumer has a canonical source.
