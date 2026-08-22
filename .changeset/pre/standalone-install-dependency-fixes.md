---
"@typecad/expect": patch
"@typecad/cuttlefish": patch
"@typecad/ui": patch
"@typecad/safety": patch
---

## Standalone-install dependency fixes

Declared the dependencies each package actually consumes at build/test time,
so installs outside the monorepo resolve without relying on hoisting:

- **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
  test harness generates `cuttlefish.config.ts` files whose
  `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
  typecheck in standalone installs) and `@typecad/framework-zephyr` as an
  optional dependency (the `west build`/`west flash` compile path requires it
  dynamically and degrades gracefully when absent).
- **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
  dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
  resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
- **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
  regular dependencies (it is imported throughout `src/`), so installing
  `@typecad/ui` pulls the transpiler automatically like every other consumer.
- **`@typecad/safety`** dropped its duplicate peerDependencies block —
  `@typecad/cuttlefish` and `@typecad/hal` were declared in both
  `dependencies` and `peerDependencies`; the regular dependencies (the pattern
  every other package uses) are kept.
