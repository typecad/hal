---
'@typecad/cuttlefish': patch
---

Follow-ups for the remaining identified issues from the demo rounds:

- **Reserved-name variable rename is consistent everywhere.** A user
  variable named like a reserved name (`log` — the libc collision) now
  renders under its escape (`log_`) at EVERY site: identifier IR creation
  consults a pre-scanned declared-names set (immune to lowering order — a
  function body lowers before the top-level declaration that names it),
  the call-statement pointer fast path escapes receivers, the getter
  rewrite matches and rebuilds with the escaped spelling, and the type
  scope registers the escaped alias so by-rendered-name lookups (enum-arg
  casts, string boundaries, map receivers) still resolve. Previously the
  declaration escaped but references emitted the raw name — uncompilable
  output. Pinned in structural-invariants.test.ts.
- **`.split()` is lowered on Zephyr** — the "tokenize with an
  indexOf/substring loop" diagnostic is gone: under the one string model
  every vector-capable target lowers `s.split(sep)` to `__tc_split`
  (std::vector<std::string>), on literal and identifier receivers alike.
- **The `??` approximation warning is honest again**: `map.get(k) ?? d`
  no longer warns (the lowering is exact — the count-guarded lookup);
  other `??` shapes keep the (hint-updated) warning.
- **`s += value` lowers to native `std::string::append`** for string and
  char values — unbounded, no intermediate buffer, no lifetime hazard.
  Formatted appends (%g/%d numbers, interpolations) keep the bounded
  snprintf accumulation.
- **Known bug pinned (it.fails)**: a top-level `new LocalCls()`
  declaration that appears AFTER a class declaration in the same file is
  captured into the class body as a member instead of emitting as a
  top-level definition — proven pre-existing (fires on the prior
  commit). The bench-supervisor demo notes the workaround.

Deliberately not done now (documented): full unification of the Map/Set
emission bodies across the statement/expression paths (the KEY-CAST half
that diverged and caused bugs is already shared via castMapKeyIfNeeded;
the remaining duplication is short, stable emission code), and a
split-mode emit fixture for the vitest harness (header invariants are
guarded by the emit-time linkage check in real builds).
