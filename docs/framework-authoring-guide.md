# Framework Authoring Guide

How to create a new framework package (e.g. `framework-rp2040`) that the
cuttlefish transpiler can target, and how to declare its coverage so the
manifest validator enforces it in CI.

This guide is the single source of truth for "what a new framework must do."
The manifest system it describes is what kills the "whack-a-mole" problem
where coverage gaps surface ad-hoc months after a framework ships.

## Prerequisites

Read these first:

- `docs/framework-coverage.md` — the rendered coverage matrix for all existing
  frameworks. Generated from manifests; do not edit.
- `docs/framework-manifest-error-codes.md` — every validator error code, its
  trigger, and how to fix it.
- `packages/framework-zephyr/src/framework.manifest.ts` — the canonical
  reference manifest. Use it as your template.

## Part 1: Create the package

Nothing here is specific to the manifest system — these are the pre-existing
requirements for any framework package.

### 1.1 Scaffold the package

```
packages/framework-rp2040/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── strategy.ts
    ├── framework.manifest.ts   ← new — see Part 2
    └── toolchain/              ← optional if you have a native build backend
        └── index.ts
```

### 1.2 `package.json`

```json
{
  "name": "@typecad/framework-rp2040",
  "version": "1.0.0-alpha.6",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./framework.manifest": {
      "types": "./dist/framework.manifest.d.ts",
      "default": "./dist/framework.manifest.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@typecad/cuttlefish": "1.0.0-alpha.14",
    "@typecad/framework-zephyr": "1.0.0-alpha.14"
  }
}
```

The `"./framework.manifest"` subpath export is **required** — without it, the
manifest loader (`loadFrameworkManifest`) cannot import your manifest and the
central test will fail.

### 1.3 Register in the workspaces list

Edit root `package.json` and add the package to the `workspaces` array
alongside the other frameworks:

```json
"workspaces": [
  "packages/framework-zephyr",
  "packages/framework-rp2040"
]
```

### 1.4 `src/strategy.ts`

A class implementing `PlatformStrategy` (defined in
`packages/cuttlefish/src/api/shared/platform-strategy.ts` — 10 sub-interfaces,
~50 methods). Either implement from scratch or extend an existing strategy (e.g.
`ZephyrStrategy`):

```ts
import { ZephyrStrategy } from '@typecad/framework-zephyr';

export class Rp2040ZephyrStrategy extends ZephyrStrategy {
  // Override the methods that differ for your board family. The rest inherit.
}
```

### 1.5 `src/index.ts`

```ts
import { Rp2040Strategy } from './strategy.js';

export { Rp2040Strategy };
export { Rp2040Strategy as FrameworkStrategy };  // loader expects this name

export { Toolchain } from './toolchain/index.js';   // or re-export the base framework's
// Optional — only if you implement them:
// export { isFrameworkLibraryImport, getFrameworkLibraryHeaderName, buildClassNameMap, tryGenerateLibDecl } from '...';
```

The loader (`packages/cuttlefish/src/framework-package.ts`) expects
`FrameworkStrategy` (a class, no-arg constructor). `Toolchain` should be an
object with `prepare?` / `compile` / `upload?` / `monitor?`.

## Part 2: Declare coverage (the new system)

This is the part that prevents whack-a-mole. Every framework must declare
its coverage in a manifest, and the validator enforces that the declaration
matches reality.

### 2.1 Register in `KNOWN_FRAMEWORK_PACKAGES`

Edit `packages/cuttlefish/src/api/shared/framework-manifest-registry.ts`:

```ts
export const KNOWN_FRAMEWORK_PACKAGES = [
  '@typecad/framework-zephyr',
  '@typecad/framework-rp2040',   // ← add
] as const;
```

Once the package is registered, the manifest loader (`loadFrameworkManifest`)
must find a default `./framework.manifest` export — a registered package
without one fails with "package does not export a default manifest". That's
expected; finish Part 2. CI enforcement comes from the validator suite
(`tests/packages/cuttlefish/validate-framework-manifest.test.ts`) plus the
per-framework test you add in §2.5.

### 2.2 Probe the strategy to learn actual coverage

Before writing the manifest, run a probe to see what your
`resolveHALOperation` actually does for every op kind:

```bash
node --input-type=module -e "
import { Rp2040Strategy } from '@typecad/framework-rp2040';
import { HAL_OPERATION_KINDS, DISPLAY_OPERATION_KINDS } from '@typecad/cuttlefish/api/shared';
const s = new Rp2040Strategy();
for (const k of [...HAL_OPERATION_KINDS, ...DISPLAY_OPERATION_KINDS]) {
  let res = 'no-emit';
  try {
    const r = k.startsWith('display.') ? s.resolveDisplayOp({operation:k}) : s.resolveHALOperation({operation:k});
    if (r && (r.code !== undefined || r.expression !== undefined)) res = 'lowers';
  } catch { res = 'throws'; }
  console.log(k.padEnd(28), res);
}
"
```

Map results to manifest op status:

| Probe result | Manifest status | Meaning |
|---|---|---|
| `lowers` | `'supported'` | Fully lowered via `resolveHALOperation`; verified by probe |
| `throws` | `'probe-inconclusive'` | Probe can't verify — resolver needs strategy-held state (e.g. `board.resolve` needs a configured board profile; `display.*` needs driver init; `dac.write` on ESP32 validates pin against actual DAC pins). Consider adding a payload template to `OP_PROBE_PAYLOADS` if the throw is just missing-arg validation rather than missing-state |
| `no-emit` | `'unsupported'` | No lowering; verify your strategy legitimately doesn't handle it |
| (special) | `'polyfill'` | Lowered via a runtime polyfill, not the HAL resolver. Only ops listed in `POLYFILL_BACKED_OPS` may use this status (currently empty — no ops are polyfill-routed). See `POLYFILL_BACKED_OPS` |
| (special) | `'stub'` | Emits code but partial/non-functional. Rare — use when a real lowering exists but isn't complete |

> **Note on `throws` vs `unsupported`:** if your resolver throws for an op
> because the minimal probe lacks valid args, declare it
> `'probe-inconclusive'` — but FIRST check whether adding a payload to
> `OP_PROBE_PAYLOADS` (in `validate-framework-manifest.ts`) would let the
> probe succeed. Many ops just need a few required fields (e.g. `i2c.write_bytes`
> needs `bus`+`bytes`, `uart.printf` needs `format`+`args`). Only fall back
> to `probe-inconclusive` if the resolver needs strategy-held state (board
> profile, display driver) that a payload can't supply.
>
> Declaring an op `'unsupported'` when the framework actually supports it is
> dishonest — the validator will eventually catch the contradiction when
> `OP_PROBE_PAYLOADS` grows an entry for it.

### 2.3 Probe the non-HAL fields

Capture the other values your manifest needs directly from the strategy:

```bash
node --input-type=module -e "
import { Rp2040Strategy } from '@typecad/framework-rp2040';
const s = new Rp2040Strategy();
console.log(JSON.stringify({
  id: s.id,
  entrypoint: s.entrypointFunctionName(),
  requiresLoop: s.requiresLoopFunction(),
  sourceExtension: s.sourceExtension(true, false),
  headerFile: s.generateHeaderFile(),
  mathHeader: s.mathHeader(),
  needsStdString: s.needsStdString(),
  needsStdVector: s.needsStdVector(),
  needsIostream: s.needsIostream(),
  needsStdFunction: s.needsStdFunction(),
  stdlib: s.getStdLibSupport(),
}, null, 2));
"
```

And polyfill ids:

```bash
node --input-type=module -e "
import { Rp2040Strategy } from '@typecad/framework-rp2040';
const s = new Rp2040Strategy();
const ids = new Set();
try { for (const ir of s.generateNativePolyfills?.({kind:'program',modules:[],classes:[],functions:[]}) ?? []) ids.add(ir.id); } catch {}
try { for (const id of s.nativePolyfills?.() ?? []) ids.add(id); } catch {}
console.log([...ids].join(', '));
"
```

And ambient type names:

```bash
node --input-type=module -e "
import { Rp2040Strategy } from '@typecad/framework-rp2040';
const s = new Rp2040Strategy();
const decls = s.ambientTypeDeclarations?.() ?? [];
const names = new Set();
for (const d of decls) {
  if (typeof d === 'string') {
    for (const m of d.matchAll(/\b(?:interface|type|class)\s+([A-Za-z_\$][\w\$]*)/g)) names.add(m[1]);
    for (const m of d.matchAll(/\bconst\s+([A-Za-z_\$][\w\$]*)\s*:/g)) names.add(m[1]);
  } else if (d && typeof d === 'object' && 'name' in d) names.add(String(d.name));
}
console.log([...names].sort().join(', '));
"
```

Each emitted polyfill id must appear in your `polyfills.emitted`. Each ambient
type name must appear in your `ambientTypes` (or you'll get an
`ambient-types/<name>/emitted-but-undeclared` warning).

### 2.4 Write `src/framework.manifest.ts`

Copy `packages/framework-zephyr/src/framework.manifest.ts` as a template.
Edit the top-level fields from your probes, then the HAL block from the
HAL probe. Skeleton:

```ts
import { defineFrameworkManifest } from '@typecad/cuttlefish/api/shared';

export default defineFrameworkManifest({
  schemaVersion: 1,
  frameworkId: 'rp2040',
  packageName: '@typecad/framework-rp2040',
  canonical: false,
  displayName: 'RP2040',
  description: 'Raspberry Pi Pico RP2040 framework.',
  basedOn: '@typecad/framework-zephyr',
  implementationMode: 'extends-canonical',
  inheritsStrategyId: 'zephyr',        // only if you reuse id='zephyr' for registry takeover

  entrypoint: {
    entrypointFunctionName: 'setup',   // must match strategy.entrypointFunctionName()
    requiresLoopFunction: true,
    sourceExtension: 'ino',            // must match strategy.sourceExtension(true, false)
    generateHeaderFile: false,
    // overrideBaseName, outputSubdirectory, customBridgeShim: only if non-default
  },

  profile: {
    targets: ['rp2040:...'],
    forcedIncludes: [],
    symbolAliases: {},                 // e.g. AVR maps delay → _native_delay_ms
  },

  hal: {
    // Every category the validator recognizes is REQUIRED — the completeness
    // check errors on any missing category (the 15 core categories in the
    // zod schema, plus the extended ones it recognizes: preferences, ble,
    // random, fs, i2s, twai, usb, eth, snprintf).
    // For categories you support, list every op kind (from HAL_OPERATION_KINDS)
    // with the status from your probe.
    gpio: {
      supported: true,
      ops: {
        'gpio.write': 'supported',
        'gpio.read': 'supported',
        'gpio.toggle': 'supported',
        'gpio.configure': 'supported',
      },
    },
    // ...the remaining categories...
    wifi: {
      supported: false,
      unsupportedReason: 'RP2040 has no native WiFi (use Pico W via CYW43439).',
      ops: {
        'wifi.join': 'unsupported',
        // ... every wifi.* op kind: 'unsupported'
      },
    },
    raw: { supported: true },
  },

  polyfills: {
    emitted: [
      { id: 'string_methods', domain: 'standard' },
      { id: 'cuttlefish_halt', domain: 'standard' },
      { id: 'timer_methods', domain: 'standard' },
      { id: 'static_array', domain: 'standard' },
      // ... every id from your polyfill probe
    ],
    suppressed: [],
  },

  toolchain: {
    backend: 'west',                                         // the toolchain backend id
    operations: { prepare: true, compile: true, upload: true, monitor: true },
    reexportedFrom: '@typecad/framework-zephyr',            // if you re-export another framework's
  },

  // Optional — omit entirely if you don't implement these
  libraryResolution: {
    isFrameworkLibraryImport: true,
    getFrameworkLibraryHeaderName: true,
    buildClassNameMap: true,
    tryGenerateLibDecl: true,
    reexportedFrom: '@typecad/framework-zephyr',
  },

  typeEmission: {
    normalizeCppType: true,
    mathHeader: '<math.h>',                                  // from probe
    needsStdString: false,
    needsStdVector: false,
    needsIostream: false,
    needsStdFunction: false,
    stdlibSupport: {
      // from probe — must deep-equal strategy.getStdLibSupport()
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: 'std_vector',
      recommendedStringImpl: 'std_string',
    },
  },

  ambientTypes: ['Preferences'],  // every name from your ambient-types probe

  conformance: {
    // Basenames of packages/framework-rp2040/tests/*.test.ts
    hardwareTestGroups: ['01-basics' /*, ... */],
    // Basenames of tests/packages/framework-rp2040/hal-resolution/*.test.ts
    halResolutionTests: ['gpio', 'i2c' /*, ... */],
  },
});
```

### 2.5 (Optional) Add a self-contained manifest test

The validator suite
(`tests/packages/cuttlefish/validate-framework-manifest.test.ts`) tests the
validator itself; the per-framework test below is what enforces your manifest
against your strategy (see `tests/packages/framework-zephyr/manifest.test.ts`
for a live example):

Create `tests/packages/framework-rp2040/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateFrameworkWithCoverage } from '../cuttlefish/manifest-test-helpers.js';

// Tolerated latent bugs go here. Empty set = zero errors allowed.
const KNOWN_STRATEGIC_ERRORS: ReadonlySet<string> = new Set<string>([
  // 'hal/display/declared-unsupported-but-actually-lowers',
]);

describe('framework-rp2040 manifest', () => {
  it('matches its implementation modulo known strategic errors', async () => {
    const { result, coverageTable } = await validateFrameworkWithCoverage('@typecad/framework-rp2040');
    console.log(coverageTable);
    const novel = result.errors.filter((e) => !KNOWN_STRATEGIC_ERRORS.has(e.code));
    expect(novel, novel.map((e) => `[${e.code}] ${e.message}`).join('\n')).toEqual([]);
  });
});
```

### 2.6 Regenerate the coverage doc

```bash
npm run render:framework-coverage
```

Updates `docs/framework-coverage.md` with your framework's row in the summary
matrix and per-category table, keeping the rendered doc in sync with your
manifest.

## Part 3: Verify

```bash
npm run build
npx vitest run tests/packages/framework-rp2040/manifest.test.ts
```

You'll see the per-op coverage table printed for your framework, and the test
fails with specific error codes if anything is inconsistent. The table uses
these symbols:

```
✓  supported           — fully lowered via resolveHALOperation
⊕  polyfill            — lowered via a runtime polyfill (see POLYFILL_BACKED_OPS)
◐  stub                — emits code but partial/non-functional
?  probe-inconclusive  — minimal probe can't verify (needs real pin args)
✗  unsupported         — no lowering (with reason)
```

Example output excerpt:

```
HAL coverage for @typecad/framework-rp2040 (14/24 categories fully supported)

timing (4/4 ops supported)
  timing.sleep               ✓
  timing.now                 ✓
  timing.now_us              ✓
  timing.busy_wait_us        ✓

wifi (0/18 supported — unsupported: RP2040 has no native WiFi.)
  wifi.join                  ✗
  ...
```

### Common first-run errors

| Error code | Fix |
|---|---|
| `identity/id-mismatch` | Add `inheritsStrategyId: 'zephyr'` if reusing the id for registry takeover |
| `entrypoint/<field>/mismatch` | Manifest value doesn't match what `strategy.entrypointFunctionName()` etc. returns |
| `hal/<cat>/op/<kind>/undeclared` | You missed an op kind — every op kind from `HAL_OPERATION_KINDS` / `DISPLAY_OPERATION_KINDS` must appear in `ops` |
| `hal/<cat>/declared-supported-but-undefined` | Category `supported: true` but resolver returns undefined for every op |
| `hal/<cat>/declared-unsupported-but-actually-lowers` | Declared unsupported but resolver lowers code — **catches inherited-broken behavior** |
| `hal/<cat>/op/<kind>/polyfill-not-recognized` | Op declared `'polyfill'` but not in `POLYFILL_BACKED_OPS`. Add the mapping to `framework-manifest.ts` (or use a different status) |
| `hal/<cat>/op/<kind>/polyfill-not-declared` | Op declared `'polyfill'` but the named polyfill isn't in `polyfills.emitted` |
| `polyfill/<id>/declared-but-not-emitted` | Manifest lists a polyfill the strategy doesn't produce |
| `polyfill/<id>/declared-suppressed-but-emitted` | Manifest suppresses a polyfill the strategy emits anyway |
| `conformance/hardware/<group>/file-not-found` | Listed group has no `packages/framework-rp2040/tests/<group>.test.ts` |
| `conformance/hal/<name>/file-not-found` | Listed test has no `tests/packages/framework-rp2040/hal-resolution/<name>.test.ts` |
| `toolchain/<op>/declared-but-missing` | Operation declared true but `Toolchain.<op>` isn't a function |
| `library-resolution/<field>/declared-but-not-exported` | Declared true but not exported from `src/index.ts` |

Full catalog with all codes in `docs/framework-manifest-error-codes.md`.

## Part 4: Iterate safely

Once your framework is in `KNOWN_FRAMEWORK_PACKAGES`, CI enforces that your
manifest matches reality on every PR. The workflow when you change framework
code:

1. **Add a new HAL op lowering** (e.g. implement `spi.read_buffer` in your
   `lowering/spi.ts`) → update `manifest.hal.spi.ops['spi.read_buffer']` from
   `'unsupported'`/`'probe-inconclusive'` to `'supported'`. If you forget,
   the test fails with `declared-unsupported-but-actually-lowers` — the gap
   is no longer silent.

2. **Add a new polyfill** (e.g. an `'rp2040_pio'` polyfill for PIO state
   machines) → add it to `polyfills.emitted`. If any HAL op kind is routed
   through it via the transpiler rather than the resolver, also add the
   op kind → polyfill id mapping to `POLYFILL_BACKED_OPS` in
   `packages/cuttlefish/src/api/shared/framework-manifest.ts` and mark the op
   `'polyfill'` in your manifest.

3. **Change entrypoint shape** (e.g. switch the entry file extension) → update
   `manifest.entrypoint`. If you forget, the test fails with
   `entrypoint/sourceExtension/mismatch`.

4. **Regenerate the doc** any time the manifest changes:
   ```bash
   npm run render:framework-coverage
   ```

## Adding a native display adapter

If your framework owns its display driver code (rather than falling back to
cuttlefish's generic adapter registry), you can provide native display
adapters that reuse your framework's existing peripheral primitives.

### When to override

Both hooks are declared optional on `PlatformGraphicsStrategy` (in
`packages/cuttlefish/src/api/shared/graphics-strategy.ts`, which
`PlatformStrategy` extends). Override `providesDisplayAdapter()` (return
`true`) and `resolveDisplayAdapter(display)` on your strategy. When
`providesDisplayAdapter()` is false or omitted, `generateDisplayAdapter()`
falls back to cuttlefish's built-in adapter registry — currently only the
SDL native desktop driver; a driver with no registered adapter throws
`No display adapter registered for driver "..."` (see
`packages/cuttlefish/src/api/shared/display-adapter.ts`).

`resolveDisplayOp(op)` is a required member: return the C++ for the display
ops your driver handles directly, and `undefined` to fall back to the generic
display lowering. Ops your adapter cannot support should throw a clear
compile-time error rather than silently emitting uncompilable code.

### The panel-ops contract

Each adapter fills a `CuttlefishPanelOps` struct with function pointers
(declared in `packages/ui/src/ui-engine/runtime-header/cuttlefish-gfx.ts`):

- `startWrite` / `endWrite` — claim/release the bus (may be nullptr).
- `setAddrWindow` — set the panel's active write region.
- `writePixels` — stream RGB565 pixels (RGB TFTs).
- `writePixel` — direct-mode single pixel.
- `fillRect` — fast path for axis-aligned fills.
- `width` / `height`.
- `flush` — backing-store flush (SSD1309/SSD1680 class panels; nullptr on
  direct-mode panels).

The `CuttlefishGFX` class (geometry/canvas/text) is emitted into the runtime
header only when `providesDisplayAdapter()` is true. Adapters reference the
already-defined `CuttlefishGFX` symbol in their `declaration` block.

### Direct vs buffered mode

- **Direct mode** (ILI9341/ST7796S-class RGB TFTs): no backing store; every
  draw hits the panel via `setAddrWindow` + `writePixels`. Required when RAM
  can't fit a framebuffer.
- **Buffered mode** (SSD1306-class mono OLEDs): RAM backing store (page
  framebuffer), pushed on demand via the `flush` op. Standard for
  page-buffered panels.

### Manifest declaration

Declare display ops the honest way for your strategy: `'supported'` when
`resolveDisplayOp` emits for the minimal probe (see the `display` block in
`packages/framework-zephyr/src/framework.manifest.ts`), `'probe-inconclusive'`
when the minimal probe cannot verify (the op needs driver/profile state the
payload can't supply). Declaring `'supported'` on an op whose resolver returns
undefined fails validation with `status-mismatch`.

### Reference implementations

- `packages/framework-zephyr/src/display/` — the Zephyr strategy-owned
  display/touch adapters and profile registry (`ui-adapter.ts`,
  `touch-adapter.ts`, `gfx.ts`, `profiles.ts`); `providesDisplayAdapter()`
  returns true and `resolveDisplayAdapter()` dispatches per resolved profile
  (see `packages/framework-zephyr/src/strategy.ts`).
- `packages/cuttlefish/src/api/shared/display-adapters/sdl.ts` — the generic
  SDL desktop adapter (the one built-in registry entry).

## Minimum-viable path

If you want the absolute smallest setup to get a new framework passing CI:

1. Add to `KNOWN_FRAMEWORK_PACKAGES` (1 line in
   `packages/cuttlefish/src/api/shared/framework-manifest-registry.ts`).
2. Add `"./framework.manifest"` subpath export to `package.json`.
3. Add the package to root `package.json` workspaces.
4. Write `src/framework.manifest.ts` — copy @typecad/framework-zephyr's as a template,
   change `frameworkId` / `packageName` / `displayName` / `description`, then
   fill in each HAL category either `supported: false` (with reason and all
   ops marked `'unsupported'`) or `supported: true` (with op statuses from
   the probe).
5. `npm run build`
6. `npm run render:framework-coverage`
7. `npx vitest run tests/packages/framework-rp2040/manifest.test.ts` —
   iterate on errors until green. Read
   `docs/framework-manifest-error-codes.md` for each code's fix.

The whole system is designed so that **the moment your framework is in
`KNOWN_FRAMEWORK_PACKAGES`, CI enforces that its manifest matches reality.**
There's no way to silently ship a framework with half-implemented HAL
categories — every coverage claim is explicit and verified against the
strategy on every test run.

## Reference

- **Schema:** `packages/cuttlefish/src/api/shared/framework-manifest.ts`
- **Validator:** `packages/cuttlefish/src/api/shared/validate-framework-manifest.ts`
- **Discovery registry:** `packages/cuttlefish/src/api/shared/framework-manifest-registry.ts`
- **HAL op kinds:** `packages/cuttlefish/src/api/shared/hal-op-ir.ts` (`HAL_OPERATION_KINDS`)
- **Display op kinds:** `packages/cuttlefish/src/api/shared/display-op-ir.ts` (`DISPLAY_OPERATION_KINDS`)
- **Per-op probe payloads:** `OP_PROBE_PAYLOADS` in `validate-framework-manifest.ts` — minimal valid args for ops whose resolver needs more than the operation discriminator (e.g. `i2c.write_bytes` needs `bus`+`bytes`, `uart.printf` needs `format`+`args`). When you add a new HAL op kind whose resolver destructures required fields, add an entry here so the validator can probe it instead of marking it `probe-inconclusive`.
- **Polyfill-routed ops:** `POLYFILL_BACKED_OPS` in `framework-manifest.ts`
- **Renderer:** `scripts/render-framework-coverage.ts`
- **Central validator suite:** `tests/packages/cuttlefish/validate-framework-manifest.test.ts`
- **Per-framework enforcement:** `tests/packages/framework-<pkg>/manifest.test.ts`
- **Test helpers:** `tests/packages/cuttlefish/manifest-test-helpers.ts`
- **Error code catalog:** `docs/framework-manifest-error-codes.md`
- **Rendered coverage matrix:** `docs/framework-coverage.md`
- **Canonical reference manifest:** `packages/framework-zephyr/src/framework.manifest.ts`
