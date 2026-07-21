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
 * so the repo root is three directories up from __dirname's parent.
 */
export function resolveRepoTestsDir(): string {
  // __dirname is tests/packages/cuttlefish (after tsc; same relative layout
  // in vitest's TS resolution). Three ups lands at the repo root.
  return path.resolve(__dirname, '..', '..', '..');
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
