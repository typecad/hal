# Transpiler Fuzzing & Global Quality Harness

Machine-checked quality mechanisms for the typecad-hal transpiler. The demo
rounds (zephyr-packet-lab → zephyr-bitbang) established the semantic envelope;
these tools find bug *classes* without touring combinations.

## The battery

| Command (repo root) | What it does | Time |
|---|---|---|
| `npx vitest run tests/packages/cuttlefish/differential.test.ts` | 12-case boundary-matrix corpus, Node vs native | ~10s |
| `FUZZ_CASES=300 FUZZ_SEED=7 npx vitest run tests/packages/cuttlefish/fuzz.test.ts` | Grammar-generated programs, both sides execute | ~2–8 min |
| `MUT_CASES=200 MUT_SEED=9 npx vitest run tests/packages/cuttlefish/mutation-fuzz.test.ts` | Type-directed mutants of the corpus | ~2 min |
| `npx vitest run tests/packages/cuttlefish/helper-parity.test.ts` | Every emitted `__tc_*` has a per-target definition | ~1s |
| `npx vitest run tests/packages/cuttlefish/placeholder-pairing.test.ts` | Every placeholder emission carries a diagnostic | ~1s |
| `node scripts/demos-strict.mjs` | All 40 demos, `--autosar=strict`, warning/error floor vs committed baseline | ~20 min |

PowerShell env vars: `$env:FUZZ_CASES="300"` (persist for the session —
`Remove-Item Env:FUZZ_CASES` to clear). `DIFF_GXX` overrides the compiler;
defaults to `g++` on PATH. The harness probes the compiler first and names
the remedy if the probe fails (a missing/dying g++ used to read as a bare
"compile failed" with empty stderr).

## Oracle pipeline

Every case runs in **Node** (the JS-semantics oracle) and as
**transpiled → host-g++ (`-std=c++20`) → native binary**; stdout is compared
line-by-line, CRLF-normalized. Divergence = transpiler semantic bug. Programs
are deterministic by construction (no Random/Time, bounded loops) — the Node
run is a valid oracle.

## Discovery mode and the work queue

The differential and fuzz tests run in discovery mode: DIVERGENCE findings
are reported and saved but do not fail the suite (the queue is documented
here and in each corpus header). FALSE REJECTIONS (a supported-grammar
program erroring) fail immediately. When a divergence is fixed, flip it into
the corpus as a hard assertion.

### Recently fixed (now hard-asserted or regression-covered)

- **Map count-guard value type** — `m.get(k) ?? fb` yields the map's value
  type on every branch; the fallback is `static_cast<V>(fb)` and both
  snprintf ladders classify the count-guarded form from the receiver's map.
- **toFixed rounding** — `__tc_toFixed` nudges by a fixed epsilon (1e-12,
  away from zero) before printf, emulating JS's half-away-from-zero on the
  decimal reading of the double (all 7 half-way probe values match Node).
- **Helper-form mutator demotion / in-place reverse / hoisted comparator
  params** — see the round-5..7 commits.

### Open work queue (fix, then move the case to hard-assert)

- **Closures format arm** — `${factoryResult(n)}` formats %d: the
  std::function-holding local's return R is visible in hal-emitter's ladder
  but not in the renderer's `buildSnprintfFromParts` path (the emission that
  bare passthrough calls use).
- **Sort comparator hoist collisions** — multiple `sort(fn)` in top-level
  `for` loops hoist comparators to colliding auto-param free functions
  (compile error, or wrong data when the collision resolves). Comparator
  hoist naming/uniqueness.
- **Name-keyed IR prescans** — `mutableArrayVars`/`unboundedArrayVars` are
  program-global by name; same-named variables in different scopes poison
  each other. Fix direction: node-keyed SemanticFacts promotion.
- **Index-write divergence** — `a1[0] = 25` vs `3` under loop+push
  combinations (fuzz seed 2026, divergence-10/3).

## Structural invariants (drift gates)

- **Helper parity**: every `__tc_*` name the lowering tables emit must have a
  definition in each target's runtime text; the allowlist carries reasons and
  a rot-guard. Adding a table row without a polyfill definition fails here.
- **Placeholder pairing**: every placeholder comment emission must carry a
  diagnostic — a fallback without a report is silent wrong code.
- **All-demos strict sweep**: committed baseline
  (`scripts/demos-strict-baseline.json`) keys error/warning signatures
  (positions stripped) per demo; new signatures fail. `--update-baseline`
  accepts the current run as the new floor; `--skip-compile` for a fast
  transpile-only pass.

## Fuzz workflow

1. Run a seed. New divergences (✗) are saved under
   `.build/differential/fuzz-run/fuzz-findings/` with `case.ts` +
   `outputs.txt` (Node output, native output, g++ stderr) — enough to
   root-cause without rerunning.
2. Shrink: cut statements until minimal. Inspect the emitted C++.
3. Root-cause in the engine; fix at the boundary.
4. Flip the case into the corpus as a hard assertion; document any pinned
   mechanism in the corpus header's work queue.

Grow the grammar and mutation sets when lowering tables grow — a table row
without a grammar production is an untested cell.
