---
"@typecad/cuttlefish": patch
---

Fix `requireUIHook()` throwing on builds in projects that do not install the
optional `@typecad/ui` package.

After the UI-engine extraction, several call sites in cuttlefish core called
`requireUIHook()` unconditionally instead of guarding with `hasUIHook()`. In a
project without `@typecad/ui`, the dynamic import in `loadUIEngine()` fails
gracefully and leaves the hook null (by design), so the first unguarded call
threw `Error: UI hook is not registered...` on every build — including plain
non-UI sketches like the starter blink project.

Guarded all unconditional call sites with `hasUIHook()` so they no-op when the
UI engine is absent, restoring the documented "UI is optional" contract:

- `cli.ts` — UI type-declaration generation (build and watch-rebuild paths)
- `transpile.ts` — parser-warning and mount-diagnostic loops
- `orchestrator/type-checker.ts` — UI module registration

Also added two helpers to `ui/ui-bridge.ts` (re-exported via
`@typecad/cuttlefish/testing`) so the test suite can reproduce a project that
has not installed `@typecad/ui`:

- `resetUIEngine()` — clears the bridge's `loaded` flag and hook, mirroring the
  other `reset*` session helpers (`clearCaches`, `resetDisplayProfile`).
- `__simulateUIAbsentForTest()` — forces the "import attempted, hook null"
  state, since the monorepo test environment otherwise eagerly registers the
  engine and masks this regression.

Added a regression test (`tests/packages/transpiler/optional-ui-no-engine.test.ts`)
covering both the type-check-skipped and type-check-enabled transpile paths
with the UI engine absent.
