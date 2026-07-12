## Rename virtual import `@typecad` → `@typecad/hal` and purge stale `@typehal` references

### Design decision (verified safe)
`@typecad/hal` is already a real package, but board packages re-export a *subset* of HAL symbols. Boards will be upgraded to `export * from '@typecad/hal'` (full re-export), making each board a **superset** of HAL. Verified: HAL's 109 export names and MCU's 45 pin names have **zero overlap**, so `export *` is collision-free. Result: `import { ... } from '@typecad/hal'` resolves to the board, giving users every HAL type *plus* board pins. Resolution logic stays clean.

---

### Part A — Functional: virtual specifier `@typecad` → `@typecad/hal`

**A1. Board packages: full HAL re-export (5 boards)**
Replace the named-subset HAL re-export block with `export * from '@typecad/hal';` in:
- `packages/board-arduino-uno/src/index.ts`
- `packages/board-esp32-devkit/src/index.ts`
- `packages/board-esp32s3/src/index.ts`
- `packages/board-esp32c3/src/index.ts`
- `packages/board-esp32c6/src/index.ts`

(Removes ~22 named symbols per board; the `export *` covers all 109. Keep the `export * from '@typecad/mcu-X'` line as-is.)

**A2. Codegen: virtual-module declaration**
- `packages/cuttlefish/src/config-loader.ts` — `generateVirtualTypeDeclaration()`: change `declare module '@typecad'` → `'@typecad/hal'` (line 525), update header comment (474) and doc comment (434, 436, 456).
- `packages/cuttlefish/src/create/init-templates.ts` — scaffolded `cuttlefish-env.d.ts`: `declare module '@typecad'` → `'@typecad/hal'` (line 279), comment (240).
- `packages/framework-arduino/src/strategy.ts` — `ambientTypeDeclarations()`: `declare module '@TypeCAD'` → `'@typecad/hal'` (line 1051), update comments (1045-1046).

**A3. Codegen: scaffolded user code + tsconfig path**
- `packages/cuttlefish/src/create/init-templates.ts`:
  - `generateStarterSketch()` line 314: `import { LED, delay } from '@typecad';` → `from '@typecad/hal';`
  - `generateProjectTsconfig()` line 90: `"@typecad": ["./.cuttlefish/board.ts"]` → `"@typecad/hal": ["./.cuttlefish/board.ts"]`

**A4. Consumers: resolution detection (the 4 sites)**
All currently check `moduleSpecifier.toLowerCase() === "@typecad"`. Change the target to `"@typecad/hal"`:
- `packages/cuttlefish/src/transpile/resolution.ts:251` (import resolver)
- `packages/cuttlefish/src/ir/board-resolver.ts:417` (board-def file resolution)
- `packages/cuttlefish/src/ir/build-ir.ts:443-446` (`isHALSource` set — change the `=== '@typecad'` member to `=== '@typecad/hal'`)
- `packages/cuttlefish/src/emit/utils/include-resolver.ts:30-31` (`isCuttlefishSDKImport` bare branch — delete it; the `startsWith("@typecad/")` branch at line 26 already catches `@typecad/hal`)

Update the case-insensitivity comments at each site to reflect the new specifier.

**A5. Regenerate committed `cuttlefish-env.d.ts` files**
- `packages/framework-arduino/cuttlefish-env.d.ts` + `.cuttlefish/cuttlefish-env.d.ts`
- `packages/hal/cuttlefish-env.d.ts` + `.cuttlefish/cuttlefish-env.d.ts`
(These are committed; regenerate via build so the `declare module` lines match. Build artifacts under `.build/` regenerate on test runs — leave those.)

**A6. Library-declaration doc generator**
- `packages/framework-arduino/src/lib-declaration.ts:402`: `from '@typecad'` → `from '@typecad/hal'` (emitted example-import line).

**A7. Test tsconfig path mappings (2 files)**
- `packages/framework-arduino/tests/tsconfig.json` and `packages/hal/tests/tsconfig.json`: the `"@typecad"` path entry → `"@typecad/hal"`. The existing `"@typecad/*": ["../../*/src"]` wildcard would route `@typecad/hal` to the real hal dir — adding an explicit `"@typecad/hal"` entry ahead of the wildcard gives it precedence and points it at the board (matches runtime).

**A8. Doc-comment updates (source accuracy, no behavior)**
- `packages/cuttlefish/src/types.ts:71,154`, `orchestrator/graph-builder.ts:87`, `orchestrator/type-checker.ts:34` — JSDoc mentions of bare `@typecad`.

---

### Part B — C++ internal identifiers `typehal_*` → `typecad_*`

**B1. Emit sites (rename namespace/function names):**
- `packages/cuttlefish/src/api/shared/async-runtime-static.ts`: `typehal_async_static` → `typecad_async_static` (namespace, ~8 refs).
- `packages/cuttlefish/src/api/shared/promise-runtime.ts`: `typehal_async` → `typecad_async`, `__typehal_async_*` → `__typecad_async_*` (namespace + using-declarations + comment, ~10 refs).
- `packages/cuttlefish/src/emit/statement-renderer.ts`: `typehal_nullish` → `typecad_nullish` (emit + comments, ~3 refs).

**B2. Test assertion:**
- `tests/polyfills.test.ts:355`: `"namespace typehal_async"` → `"namespace typecad_async"`.

(`dist/` mirrors regenerate on build; no hand-edit.)

---

### Part C — Purge stale `@typehal` scope (user-facing surface)

**C1. Root `README.md`** — full rewrite of the ~25 occurrences: `@typehal` → `@typecad`, virtual import `from '@typehal'` → `from '@typecad/hal'`, `typehal` CLI → `cuttlefish`, `TypehalConfig` → `TypecadConfig`. Remove references to non-existent `@typehal/create`, `@typehal/core`, bare `npm install typehal`. Board table rows 84-86 use `@typecad/board-*`.

**C2. Package READMEs (fix H1 scope + content):**
- `packages/board-arduino-uno/README.md`, `packages/mcu-atmega328p/README.md`, `packages/framework-arduino/README.md`, `packages/framework-avr/README.md` — `@typehal/*` → `@typecad/*`, virtual imports → `@typecad/hal`.
- `packages/expect/README.md:78`, `packages/hal/README.md:96`, `packages/hal/HAL-GUIDE.md` — `@TypeCAD`/`@typehal` references → `@typecad/hal`.

**C3. Shipped source doc:**
- `packages/board-arduino-uno/src/USAGE.md` — `@typehal/*` → `@typecad/*`, virtual `@typehal` → `@typecad/hal`, `typehal.config.ts` → `cuttlefish.config.ts`, drop `@typehal/core`.

**C4. Examples (`examples/**/*.ts`, `examples/README.md`):**
- Bare `from '@typecad'` → `from '@typecad/hal'`; any `@typehal` → `@typecad`.

**C5. Docs (`docs/hal/*.md`, `docs/ownership/*.md`):**
- `@typehal`/`@TypeCAD` → `@typecad/hal`; `typehal` CLI → `cuttlefish`.

**C6. Test fixtures asserting/using the specifier:**
Update input fixtures + assertions to the new specifier:
- `tests/packages/transpiler/init-scaffold.test.ts:188` (scaffold output)
- `tests/packages/transpiler/multi-file.test.ts:405,447,505`
- `tests/packages/expect/expect-preprocessor.test.ts:12,22,27,80,193`
- `tests/packages/expect/expect-integration.test.ts:24`
- `tests/packages/framework-arduino/arduino-libs.test.ts:351`
- The hal/framework-arduino hardware test files using `@TypeCAD`: `99-board-dynamic.test.ts`, `hal/tests/01-gpio.test.ts`, `07-interrupts`, `08-uart`, `09-i2c`, `10-spi`, `11-adc`, `15-async`, `16-constants`.

**C7. Other test files referencing `typehal`** (comments/strings): `tests/bug-fixes.test.ts`, `tests/packages/cuttlefish/ui-*.test.ts`, `tests/packages/transpiler/{config-loader,demo-14-regressions,init-scaffold,multi-file,transpile-imports,ui-integration,watch}.test.ts` — update scope references and any `typehal` CLI mentions.

**C8. Stale comment:**
- `packages/cuttlefish/src/debug/breakpoint-loader.ts:23` — `.typehal` → `.cuttlefish` (code uses `CUTTLEFISH_DIR`; comment only).

**C9. Config files (private/excluded — out of publication scope but tidy):**
- `.changeset/config.json` `ignore` list references `vscode-typehal-debug` (folder name) — leave folder name, it's not a package. `vscode-typehal-debug/package.json` + `src/extension.ts` are private — defer unless you want them now.
- `packages/framework-arduino/.typehal-cache.json` — cache filename; will rename when the codegen that reads/writes it is confirmed (verify no `typehal-cache` literal in src — confirmed only a `.typehal` *comment* exists, so this cache file is written under its current name by framework tooling; leaving the filename avoids invalidating existing caches).

---

### Verification (per AGENTS.md)

```
npm run typecheck
npm run build --workspace @typecad/cuttlefish   # regenerates dist mirrors for B1/B2
npm test                                          # 219 files; expect green after fixture updates
```

### Out of scope (explicitly)
- `vscode-typehal-debug/` (private extension, not published)
- `docs/superpowers/plans/*` and `docs/superpowers/specs/*` (historical planning docs)
- `.typehal-cache.json` filename (cache invalidation risk, no functional impact)
- Generated `.build/**/cuttlefish-env.d.ts` and `dist/` mirrors (regenerate on build/test)