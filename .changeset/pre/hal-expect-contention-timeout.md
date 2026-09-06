---
"@typecad/hal": patch
---

Root-cause the hal-expect-blackpill full-battery flake: CPU-contention
timeout, not cross-file state.

The blackpill dry-run's beforeAll (board-constant resolution + a full
transpile of the suite program) completes in seconds standalone but
intermittently exceeded vitest's default 60s hook timeout under a full
parallel battery — the identical board-resolver workload in
create-framework.test.ts timed out explicitly in the same run, which pinned
the mechanism (vitest's forks pool isolates each test file in its own
process, so the previously suspected module-global chip state cannot leak
between files). The heavy hooks and the board-resolver consistency test now
carry explicit 180s timeouts, and both hal-expect file headers record the
real rationale.
