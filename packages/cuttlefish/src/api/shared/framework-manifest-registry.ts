// ---------------------------------------------------------------------------
// Framework manifest discovery
//
// KNOWN_FRAMEWORK_PACKAGES is the authoritative list of framework packages.
// Add a new framework here when it ships. loadFrameworkManifest uses the
// "./framework.manifest" subpath export each framework declares in its
// package.json.
// ---------------------------------------------------------------------------

import type { FrameworkManifest } from './framework-manifest.js';

export const KNOWN_FRAMEWORK_PACKAGES = [
  '@typecad/framework-arduino',
  '@typecad/framework-zephyr',
] as const;

export type KnownFrameworkPackage = typeof KNOWN_FRAMEWORK_PACKAGES[number];

/**
 * Loads a framework's manifest via its `./framework.manifest` subpath export.
 * Throws if the package does not export that subpath or the export has no
 * default value.
 */
export async function loadFrameworkManifest(
  packageName: string,
): Promise<FrameworkManifest> {
  const mod = await import(/* @vite-ignore */ `${packageName}/framework.manifest`);
  if (!mod.default) {
    throw new Error(
      `Package ${packageName} does not export a default manifest from "./framework.manifest".`,
    );
  }
  return mod.default as FrameworkManifest;
}
