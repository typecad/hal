---
'@typecad/hal': patch
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Dead-code cleanup from the Zephyr-first pass:

- **Dropped the fluent map/constrain chains** — `MapChain`/`ConstrainChain`, `Num.map(x).from(a,b).to(c,d)`, `Num.constrain(x).between(l,h)`, and the corresponding `__tc_Num` polyfill members in both framework strategies. Nothing used them (verified across hal/frameworks/tests/demos), and they were the fluent form of the `map()`/`constrain()` vocabulary already dropped from the user surface. `Num.abs/min/max` and the free trio stay (bare-call polyfills on every framework), and the `usesMap`/`usesConstrain`-gated free-function polyfills stay — the UI runtime's generated draw code calls them.
- **Stale comment fixes**: the three hal-side comments still naming `pwm_set_period_dt` (removed from the lowerings when the hardware run proved Zephyr 4.4 has no period-only setter) now describe the real `pwm_set_dt` behavior.
- **Test hygiene**: the hal expect dry-run suite restores the module-global chip descriptor in `afterAll` (the blackpill run repointed it, leaking into test files sharing a vitest worker).

Known issue recorded (not introduced here): combining the hal-resolution directory with the expect suite in one cold parallel vitest run intermittently yields an empty transpile output file (`.build/tests` write race under cold workers) — the suites pass consistently when run as separate vitest invocations. Follow-up: per-file output dirs or sequential config for the e2e group.
