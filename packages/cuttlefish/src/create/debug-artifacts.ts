// ---------------------------------------------------------------------------
// debug-artifacts.ts — create-time framework debug profile generation
//
// `cuttlefish create` scaffolds a project that has never been built, so the
// framework toolchain's post-build debug-artifact writer (e.g. Zephyr's
// writeDebugConfig, which runs after a successful `west build --debug`) has
// never had a chance to run. Without a .vscode/launch.json, pressing F5 in VS
// Code just opens the "select a debugger" menu.
//
// Frameworks that support native debugging may export
// `writeProjectDebugArtifacts({ workspaceRoot, buildTarget })` from their
// package root (see @typecad/framework-zephyr). This helper loads the freshly
// installed framework package and invokes that export — the framework decides
// whether the target is debug-capable and what to write. Frameworks without
// the export (or targets without native debug support) are a silent no-op.
//
// Everything here is best-effort: a failed or skipped generation never fails
// `cuttlefish create`, because the first `--debug` build still writes the
// artifacts the hard way.
// ---------------------------------------------------------------------------

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFrameworkPackage } from "../framework-package.js";

export interface FrameworkDebugArtifactsOptions {
  /** Framework package name (e.g. '@typecad/framework-zephyr'), if known. */
  frameworkPackage?: string;
  /** Absolute path to the new cuttlefish project root. */
  workspaceRoot: string;
  /** The framework build target (e.g. Zephyr board id), if known. */
  buildTarget?: string;
}

/**
 * Module loader for the framework package. Returns the loaded module, or
 * undefined when it cannot be resolved. Injectable for tests.
 */
export type FrameworkModuleLoader = (packageName: string) => any | undefined;

const cliModuleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generate the framework's starter debug artifacts for a new project.
 * Returns the workspace-relative paths written (e.g. ['.vscode/launch.json']),
 * or [] when the framework has no debug support, isn't resolvable yet, or the
 * generator failed (warns, never throws).
 */
export function generateFrameworkDebugArtifacts(
  o: FrameworkDebugArtifactsOptions,
  loadModule?: FrameworkModuleLoader,
): string[] {
  if (!o.frameworkPackage || !o.workspaceRoot) return [];

  // Default loader: prefer the new project's node_modules (populated by the
  // create install step), then the CLI's own module location (monorepo /
  // --no-install flows where the framework is a workspace sibling of the
  // running cuttlefish).
  const loader: FrameworkModuleLoader = loadModule ?? ((packageName) => {
    for (const dir of [o.workspaceRoot, cliModuleDir]) {
      try {
        return loadFrameworkPackage(packageName, dir);
      } catch {
        // not resolvable from this location — try the next
      }
    }
    return undefined;
  });

  let mod: any;
  try {
    mod = loader(o.frameworkPackage);
  } catch {
    return [];
  }
  if (!mod || typeof mod.writeProjectDebugArtifacts !== "function") return [];

  try {
    const written = mod.writeProjectDebugArtifacts({
      workspaceRoot: o.workspaceRoot,
      buildTarget: o.buildTarget,
    });
    return Array.isArray(written) ? written.map(String) : [];
  } catch (e) {
    console.warn(`! Debug profile generation failed: ${(e as Error).message}`);
    return [];
  }
}
