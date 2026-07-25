// Shared helpers for the central and per-framework manifest tests.
//
// loadFrameworkPackage() (from @typecad/cuttlefish) returns the framework
// module's raw exports and populates the singleton via setLoadedFramework.
// The structured LoadedFramework (strategy, toolchain, libraryResolver) is
// retrieved separately via getLoadedFramework().

import * as path from 'node:path';
import * as url from 'node:url';
import { loadFrameworkPackage, getLoadedFramework } from '@typecad/cuttlefish';
import {
  loadFrameworkManifest,
  HAL_OPERATION_KINDS,
  DISPLAY_OPERATION_KINDS,
  HAL_CATEGORIES,
  POLYFILL_BACKED_OPS,
  type FrameworkManifest,
  type ManifestValidationContext,
  type ManifestValidationResult,
  validateFrameworkManifest,
} from '@typecad/cuttlefish/api/shared';

/**
 * Resolves the absolute path to a framework package root by walking up from
 * the package's resolved main entry (dist/index.js → package dir).
 */
export function resolveFrameworkPackageRoot(packageName: string): string {
  const mainPath = url.fileURLToPath(import.meta.resolve(packageName));
  // dist/index.js → package root is the parent of dist/.
  return path.resolve(path.dirname(mainPath), '..');
}

/**
 * Resolves the repo-rooted tests directory: <repoRoot>/tests.
 * This file lives at tests/packages/cuttlefish/manifest-test-helpers.ts,
 * so the tests dir is two directories up from __dirname.
 */
export function resolveRepoTestsDir(): string {
  // __dirname is tests/packages/cuttlefish (after tsc; same relative layout
  // in vitest's TS resolution). Two ups lands at <repoRoot>/tests.
  return path.resolve(__dirname, '..', '..');
}

/**
 * Loads a framework's manifest and implementation, returning both plus a
 * ready-to-use ManifestValidationContext.
 */
export async function loadFrameworkForValidation(packageName: string): Promise<{
  manifest: FrameworkManifest;
  moduleExports: Record<string, unknown>;
  context: ManifestValidationContext;
}> {
  const manifest = await loadFrameworkManifest(packageName);
  const moduleExports = loadFrameworkPackage(packageName) as Record<string, unknown>;
  const loaded = getLoadedFramework();
  if (!loaded) {
    throw new Error(
      `loadFrameworkPackage(${packageName}) did not populate the loaded framework singleton`,
    );
  }
  const context: ManifestValidationContext = {
    strategy: loaded.strategy,
    toolchain: loaded.toolchain,
    moduleExports,
    packageRoot: resolveFrameworkPackageRoot(packageName),
    repoTestsDir: resolveRepoTestsDir(),
  };
  return { manifest, moduleExports, context };
}

/**
 * Convenience: load + validate in one call.
 */
export async function validateFramework(packageName: string): Promise<ManifestValidationResult> {
  const { manifest, context } = await loadFrameworkForValidation(packageName);
  return validateFrameworkManifest(manifest, context);
}

// ---------------------------------------------------------------------------
// Per-op HAL coverage report
//
// Builds a human-readable table from a manifest's hal block. Printed by the
// manifest tests on every run so you can see exactly which HAL op kinds are
// declared supported/partial/inconclusive/unsupported/polyfill for the
// framework under test.
//
// The manifest is the source of truth — the validator already verified it
// matches resolver behavior, so we don't re-probe here.
//
// Symbol legend (5-state):
//   ✓  supported           — fully lowered via resolveHALOperation
//   ⊕  polyfill            — lowered via runtime polyfill (not HAL resolver)
//   ◐  stub / partial      — emits code but partial/non-functional
//   ?  probe-inconclusive  — minimal probe can't verify (needs real pin args)
//   ✗  unsupported         — no lowering (with reason)

type OpStatusValue = 'supported' | 'stub' | 'unsupported' | 'probe-inconclusive' | 'polyfill';

function symbolFor(status: OpStatusValue): string {
  switch (status) {
    case 'supported': return '✓';
    case 'polyfill': return '⊕';
    case 'stub': return '◐';
    case 'probe-inconclusive': return '?';
    case 'unsupported': return '✗';
  }
}

function opKindsForCategory(category: string): string[] {
  // Schema category names: 'interrupts' (plural) maps to op kind prefix 'interrupt.'
  const prefix = category === 'interrupts' ? 'interrupt.' : `${category}.`;
  const source = category === 'display' ? DISPLAY_OPERATION_KINDS : HAL_OPERATION_KINDS;
  // For non-display categories we still need display kinds excluded; HAL_OPERATION_KINDS
  // already excludes them. For display, use DISPLAY_OPERATION_KINDS.
  if (category === 'display') {
    return [...DISPLAY_OPERATION_KINDS].filter((k) => k.startsWith(prefix));
  }
  return HAL_OPERATION_KINDS.filter((k) => k.startsWith(prefix));
}

/**
 * Renders a per-op coverage table for a framework's manifest. Returns a
 * multi-line string suitable for console.log in a test body.
 *
 * Example output:
 *
 *   HAL coverage for @typecad/framework-esp32 (14/18 categories supported)
 *
 *   gpio (4/4 supported)
     gpio.write         ✓
     gpio.read          ✓
     gpio.toggle        ✓
     gpio.set_mode      ✓
 *
 *   wifi (35/35 supported)
     wifi.connect       ✓
     ...
 *
 *   display (0/5 supported — unsupported: Deferred to v1.1; ...)
     display.init       ✗
     ...
 */
export function renderHalCoverageTable(manifest: FrameworkManifest): string {
  const hal = manifest.hal as Record<string, {
    supported: boolean;
    partialCoverage?: boolean;
    unsupportedReason?: string;
    ops: Record<string, OpStatusValue>;
  }>;

  const lines: string[] = [];
  const shortName = manifest.packageName.replace('@typecad/', '');
  // Render core categories first (HAL_CATEGORIES), then any extended categories
  // a framework declares via the catchall (i2s, twai, espnow, ...). This makes
  // the coverage table a complete record of the manifest's declared surface —
  // otherwise unsupported extended categories (the unimplemented-peripheral
  // roadmap) are silently omitted.
  const declaredCats = Object.keys(hal).filter((c) => c !== 'raw');
  const extendedCats = declaredCats.filter((c) => !(HAL_CATEGORIES as readonly string[]).includes(c));
  const allCats = [...HAL_CATEGORIES, ...extendedCats];
  let catSupported = 0;
  for (const cat of allCats) {
    if (hal[cat]?.supported && !hal[cat]?.partialCoverage) catSupported++;
  }
  lines.push(``);
  lines.push(`HAL coverage for ${manifest.packageName} (${catSupported}/${allCats.length} categories fully supported)`);
  lines.push(``);

  for (const cat of allCats) {
    const decl = hal[cat];
    if (!decl) {
      lines.push(`${cat} (undeclared)`);
      lines.push(``);
      continue;
    }
    const opKinds = opKindsForCategory(cat);
    const supportedCount = opKinds.filter((k) => decl.ops[k] === 'supported').length;
    const polyfillCount = opKinds.filter((k) => decl.ops[k] === 'polyfill').length;
    const coveredCount = supportedCount + polyfillCount;
    const catLabel = decl.supported
      ? (decl.partialCoverage
          ? `${cat} (partial: ${supportedCount} supported + ${polyfillCount} polyfill = ${coveredCount}/${opKinds.length} ops covered)`
          : `${cat} (${supportedCount}/${opKinds.length} supported)`)
      : `${cat} (0/${opKinds.length} supported — unsupported: ${decl.unsupportedReason ?? 'no reason given'})`;
    lines.push(catLabel);

    // Compute column width for alignment.
    const maxKindLen = Math.max(...opKinds.map((k) => k.length));
    for (const kind of opKinds) {
      const status = decl.ops[kind] ?? 'unsupported';
      const padded = kind.padEnd(maxKindLen);
      const sym = symbolFor(status);
      let note = '';
      if (status === 'polyfill') {
        const polyfillId = POLYFILL_BACKED_OPS[kind];
        if (polyfillId) note = `  (${polyfillId})`;
      } else if (status === 'unsupported' && decl.unsupportedReason && opKinds.length === 1) {
        note = `  (${decl.unsupportedReason})`;
      }
      lines.push(`  ${padded}  ${sym}${note}`);
    }
    lines.push(``);
  }

  lines.push(`Legend: ✓ supported  ⊕ polyfill  ◐ stub  ? probe-inconclusive  ✗ unsupported`);

  return lines.join('\n');
}

/**
 * Loads a framework's manifest and returns both the validation result and a
 * printable coverage table. Convenience for the per-framework manifest tests.
 */
export async function validateFrameworkWithCoverage(packageName: string): Promise<{
  result: ManifestValidationResult;
  coverageTable: string;
}> {
  const { manifest, context } = await loadFrameworkForValidation(packageName);
  const result = validateFrameworkManifest(manifest, context);
  const coverageTable = renderHalCoverageTable(manifest);
  return { result, coverageTable };
}
