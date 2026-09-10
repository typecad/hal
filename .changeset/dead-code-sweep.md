---
"@typecad/cuttlefish": patch
---

fix: dead-code sweep of the curated-board-era leftovers. Removed the `mcu` config chain the same way `target` went (the test-runner parsed it and the synthesized test config re-emitted it, but `TypecadConfig` has no `mcu` field since the curated `@typecad/mcu-*` packages were removed); the `mcu` option of `printBuildInfo` (the sole caller passes only `board`); the `cuttlefish.config.js` / `.mjs` / `.cjs` legacy filename candidates in the test-runner's config discovery and the ui package's project-root walk — the engine loader only ever discovers `typecad-hal.config.ts`, so those candidates could only half-work; the transpile-graph skip for `@typecad/board-*` / `@typecad/mcu-*` import specifiers (both curated package families are gone — such imports now fail module resolution with a pointing error instead of vanishing silently); and the never-read `core` field of `LibraryDefinitionCondition`.
