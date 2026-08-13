---
"@typecad/cuttlefish": minor
---

## cuttlefish create: framework catalog + create-time dependency install

Reworks the create/install flow:

- Moves the framework catalog + board→framework compatibility out of
  `src/install/` into `src/create/framework-catalog.ts` — the single source of
  truth for which `@typecad/framework-<id>` packages exist and which are
  compatible with a given board architecture. Deliberately side-effect-free
  (only lockfile/package.json reads) so it unit-tests cleanly.
- `cuttlefish create` now installs the new project's dependencies as its final
  step (`src/create/install-deps.ts`), detecting the package manager
  (npm/yarn/pnpm) from the invoking directory — so a pnpm/yarn user gets their
  tool of choice even though the new project has no lockfile yet, and the
  scaffolded project is ready to build with no separate `npm install`.
- The init wizard's framework selection uses the catalog.

(The earlier `cuttlefish install` command landed in alpha.9; this reworks its
internals into `create/` and adds the create-time dependency install.)
