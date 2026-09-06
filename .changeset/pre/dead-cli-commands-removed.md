---
'@typecad/cuttlefish': minor
---

## Dead CLI commands removed

Four command surfaces that the workspace consolidation (and the earlier
board-package deletion) left orphaned are gone from the `cuttlefish` binary:

- **`gen-libdefs`** — seeded `.libdef.json` stubs for a TS file's imports.
  Superseded twice over: the pipeline loads library definitions automatically,
  cuttlefish library packages ship their own libdefs via shims, and a missing
  libdef already falls back gracefully (identity symbol map + guessed
  `<PascalCase>.h` include). The `generateLibraryDefinitions` API and the
  `generateLibdefStubs` registry helper are removed with it.
- **`map-error`** — manual C++→TypeScript source-map lookup. `cuttlefish build
  --compile` maps every compiler diagnostic back to TypeScript automatically
  (`printMappedCompileErrors`); no tooling used the standalone command. The
  mapping engine itself (`mapping/source-map.ts`) is unchanged and still powers
  the automatic path; only the unused `resolveMapPath` helper went with it.
- **`gen-decls --components`** — the ESP-IDF managed-components scan
  (`component-decls.ts`, `component-discovery.ts`, the pre-transpile component
  pass, and the `./lib/component-decls` export). No esp-idf framework ever
  shipped and nothing consumes `frameworkConfig.components`. Plain
  `gen-decls <file|--all>` is unchanged — the VS Code TypeCAD Debug extension
  still uses it.
- **`create-board` tombstone** — the parser stub that only threw "removed, use
  @typecad/create" is gone.

The scaffolded `package.json` no longer emits the `gen-decls`/`gen-libdefs`
scripts (both errored on bare invocation), and docs no longer reference
`board-add`, `create-board`, `gen-libdefs`, `map-error`, or the removed
Arduino framework/`arduino-cli` toolchain.
