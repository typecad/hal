// ---------------------------------------------------------------------------
// debug-artifacts.ts — create-time framework debug profile generation
//
// `typecad-hal create` scaffolds a project that has never been built, so the
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
// `typecad-hal create`, because the first `--debug` build still writes the
// artifacts the hard way.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFrameworkPackage } from "../framework-package.js";
import { checkZephyrSdk } from "../board-catalog/index.js";

export interface FrameworkDebugArtifactsOptions {
  /** Framework package name (e.g. '@typecad/framework-zephyr'), if known. */
  frameworkPackage?: string;
  /** Absolute path to the new typecad-hal project root. */
  workspaceRoot: string;
  /** The framework build target (e.g. Zephyr board id), if known. */
  buildTarget?: string;
  /**
   * The scaffolded app dir, workspace-relative with forward slashes
   * ('src/out' for the standard layout). The framework would otherwise
   * assume the default — wrong the moment the user renames outDir.
   */
  appRel?: string;
}

/**
 * Create-time best-effort gdb path for the F5 launch entry. VS Code
 * snapshots launch.json BEFORE running the preLaunchTask, and the task is
 * what produces the build (and with it west's authoritative gdb resolution
 * in runners.yaml) — without a starter path, the very FIRST F5 on a fresh
 * project fails to find gdb. This resolves the SDK's gdb for the board's
 * silicon; the first build replaces it with west's own answer (and a
 * mismatch triggers the artifact rewrite).
 *
 * The soc → toolchain mapping is silicon truth (the gdb must match the
 * core's architecture); ambiguous dual-arch socs (rp2350 arm/riscv) return
 * undefined rather than guess wrong.
 */
const SOC_TOOLCHAIN: ReadonlyArray<readonly [RegExp, string]> = [
  [/^esp32s2/, 'xtensa-espressif_esp32s2_zephyr-elf'],
  [/^esp32s3/, 'xtensa-espressif_esp32s3_zephyr-elf'],
  [/^esp32[c|h]/, 'riscv64-zephyr-elf'],
  [/^esp32/, 'xtensa-espressif_esp32_zephyr-elf'],
  [/^rp2350/, ''], // dual-arch soc — no honest guess
];

export function createStarterGdbPath(soc?: string): string | undefined {
  if (!soc) return undefined;
  const sdk = checkZephyrSdk();
  if (sdk.status !== 'ok' || !sdk.toolchainDir) return undefined;
  const toolchain = SOC_TOOLCHAIN.find(([re]) => re.test(soc))?.[1] ?? 'arm-zephyr-eabi';
  if (toolchain === '') return undefined;
  const gdbName = `${toolchain}-gdb.exe`;
  // SDK ≤0.17.x lays toolchains flat; SDK 1.x under gnu/.
  for (const bin of [
    path.join(sdk.toolchainDir, 'gnu', toolchain, 'bin'),
    path.join(sdk.toolchainDir, toolchain, 'bin'),
  ]) {
    const gdb = path.join(bin, gdbName).replace(/\\/g, '/');
    if (fs.existsSync(gdb)) return gdb;
  }
  return undefined;
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
    // soc from the build target's qualifier ('board/soc/variant') — the
    // silicon that decides the gdb toolchain.
    const soc = o.buildTarget?.split('/')[1];
    const gdbPath = createStarterGdbPath(soc);
    const written = mod.writeProjectDebugArtifacts({
      workspaceRoot: o.workspaceRoot,
      buildTarget: o.buildTarget,
      ...(o.appRel !== undefined ? { appRel: o.appRel } : {}),
      ...(gdbPath ? { gdbPath } : {}),
    });
    return Array.isArray(written) ? written.map(String) : [];
  } catch (e) {
    console.warn(`! Debug profile generation failed: ${(e as Error).message}`);
    return [];
  }
}
