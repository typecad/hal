# Framework Manifest Error Codes

Every error produced by `validateFrameworkManifest` (in
`packages/cuttlefish/src/api/shared/validate-framework-manifest.ts`) carries a
stable `code` of the form `<category>/<subject>/<reason>`. This catalog lists
every code, when it fires, and how to fix it.

Warnings are prefixed `W/` and surface in the validator's `warnings` array
but do not fail the build.

## Identity

| Code | Trigger | Fix |
|---|---|---|
| `identity/id-mismatch` | `strategy.id` ≠ `manifest.frameworkId` and no `inheritsStrategyId` declared | Set distinct strategy ids, or add `inheritsStrategyId: "<strategy.id>"` to the manifest to document intentional id reuse (a derived framework may reuse its base's strategy id) |

## Entrypoint

| Code | Trigger | Fix |
|---|---|---|
| `entrypoint/entrypointFunctionName/mismatch` | Declared value differs from `strategy.entrypointFunctionName()` | Update manifest or strategy |
| `entrypoint/requiresLoopFunction/mismatch` | Declared value differs from `strategy.requiresLoopFunction()` | Update manifest or strategy |
| `entrypoint/sourceExtension/mismatch` | Declared value differs from `strategy.sourceExtension(true, false)` | Update manifest or strategy |
| `entrypoint/generateHeaderFile/mismatch` | Declared value differs from `strategy.generateHeaderFile()` | Update manifest or strategy |

## HAL coverage

The HAL coverage validator probes `resolveHALOperation` (and `resolveDisplayOp`
for `display.*` ops) with a minimal payload carrying just the operation
discriminator. Op status is one of `supported`, `polyfill`, `stub`,
`unsupported`, or `probe-inconclusive`:

- `supported` — fully lowered via `resolveHALOperation`; verified by probe.
- `polyfill` — lowered via a runtime polyfill, NOT the HAL resolver. Verified
  by checking the op kind exists in `POLYFILL_BACKED_OPS`
  (`packages/cuttlefish/src/api/shared/framework-manifest.ts`) AND the named
  polyfill id is present in `polyfills.emitted`. Use for ops like
  `timing.set_interval` that route through the `timer_methods` polyfill
  rather than the resolver.
- `stub` — emits code but partial/non-functional; verified by probe.
- `unsupported` — no lowering; verified by probe.
- `probe-inconclusive` — minimal probe can't determine support (typically
  because the resolver needs a valid pin/config payload). The validator
  skips cross-checks; the renderer flags them for manual review.

| Code | Trigger | Fix |
|---|---|---|
| `hal/<cat>/declared-supported-but-undefined` | Category `supported: true` but resolver returns `undefined`/throws for every verifiable op | Implement lowering or change status to `unsupported` with a reason |
| `hal/<cat>/declared-unsupported-but-actually-lowers` | Category `supported: false` but resolver lowers at least one verifiable op | Either mark supported or override the resolver to throw/return undefined. **This code catches inherited-broken behavior** — e.g. a framework that inherits the parent's `resolveDisplayOp` without overriding it will lower display ops despite declaring display unsupported. |
| `hal/<cat>/op/<kind>/status-mismatch` | Per-op status disagrees with resolver behavior | Align op status with reality |
| `hal/<cat>/op/<kind>/undeclared` | Known op kind (from `HAL_OPERATION_KINDS` / `DISPLAY_OPERATION_KINDS`) missing from `manifest.hal.<cat>.ops` | Add the missing op kind |
| `hal/<cat>/op/<kind>/polyfill-not-recognized` | Op declared `polyfill` but not in `POLYFILL_BACKED_OPS` | Add the op kind → polyfill id mapping to `packages/cuttlefish/src/api/shared/framework-manifest.ts`, or use a different status |
| `hal/<cat>/op/<kind>/polyfill-not-declared` | Op declared `polyfill` (mapping says backed by polyfill X) but X not in `polyfills.emitted` | Add the polyfill to `polyfills.emitted`, or remove this op from polyfill status |

### Known strategic violations

`KNOWN_STRATEGIC_ERRORS` in `tests/packages/cuttlefish/framework-manifest.test.ts`
is currently empty — no framework ships with tolerated manifest errors. The
central test fails on any error so regressions surface immediately. Add an
entry there only with a documented justification (e.g. a known
`resolveDisplayOp` inheritance mismatch awaiting a dedicated fix).

## Polyfills

A polyfill is "produced" if either `generateNativePolyfills()` OR
`nativePolyfills()` mentions it. The former filters by program analysis (may
omit polyfills not needed for the probe's synthetic empty program); the
latter is the unconditional set the strategy claims to handle natively.

| Code | Trigger | Fix |
|---|---|---|
| `polyfill/<id>/declared-but-not-emitted` | Polyfill listed in `emitted` but not produced by either method | Remove from `emitted` or implement |
| `polyfill/<id>/declared-suppressed-but-emitted` | Polyfill listed in `suppressed` but actually produced | Remove from `suppressed` or stop producing |

## Toolchain

| Code | Trigger | Fix |
|---|---|---|
| `toolchain/compile/required` | `toolchain.operations.compile: false` | Must be true (LoadedFramework contract requires a compile implementation) |
| `toolchain/<op>/declared-but-missing` | Operation declared true but not a function on the loaded Toolchain object | Implement or change declaration |

## Library resolution

| Code | Trigger | Fix |
|---|---|---|
| `library-resolution/<field>/declared-but-not-exported` | Field declared true but corresponding named export missing from framework index | Export it from `src/index.ts` or change declaration. (`field` ∈ `isFrameworkLibraryImport`, `getFrameworkLibraryHeaderName`, `buildClassNameMap`, `tryGenerateLibDecl`.) |

## Type emission

| Code | Trigger | Fix |
|---|---|---|
| `type-emission/<field>/mismatch` | `mathHeader`, `needsStdString`, `needsStdVector`, `needsIostream`, or `needsStdFunction` differs from strategy method | Align manifest with strategy |
| `type-emission/stdlib-support-mismatch` | `stdlibSupport` object ≠ `strategy.getStdLibSupport()` | Update one |

## Ambient types

Ambient type names are extracted from `strategy.ambientTypeDeclarations()`
output by matching `interface|type|class NAME` and `const NAME:` patterns.

| Code | Trigger | Fix |
|---|---|---|
| `ambient-types/<name>/declared-but-not-emitted` | Listed in `ambientTypes` but not found in `ambientTypeDeclarations()` output | Add or remove |
| `W/ambient-types/<name>/emitted-but-undeclared` | Strategy emits but manifest doesn't list | Add to manifest (warning only) |

## Conformance

| Code | Trigger | Fix |
|---|---|---|
| `conformance/hardware/<group>/file-not-found` | Listed `hardwareTestGroups` entry has no `<packageRoot>/tests/<group>.test.ts` | Remove from list or add the test |
| `conformance/hal/<name>/file-not-found` | Listed `halResolutionTests` entry has no `<repoTestsDir>/packages/<package-dir-name>/hal-resolution/<name>.test.ts` | Remove from list or add the test. `<package-dir-name>` is the last segment of `packageName` (e.g. `framework-zephyr`). |

## Adding a new error code

1. Pick a code of the form `<category>/<subject>/<reason>` using existing
   category prefixes (`identity`, `entrypoint`, `hal`, `polyfill`,
   `toolchain`, `library-resolution`, `type-emission`, `ambient-types`,
   `conformance`).
2. Add the code as a constant or inline string in `validate-framework-manifest.ts`.
3. Add a row to the appropriate table above.
4. If the code is a warning (not an error), prefix it with `W/`.
5. If the code can be triggered by a unit test, add a case to
   `tests/packages/cuttlefish/validate-framework-manifest.test.ts`.
