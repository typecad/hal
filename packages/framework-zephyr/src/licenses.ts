// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — Zephyr license scanner
//
// Zephyr-specific enumeration + presenter for the `typecad-hal licenses`
// subcommand. The framework-agnostic SPDX detection engine lives in the shared
// cuttlefish core (`@typecad/cuttlefish/api/shared`); this module owns only the
// Zephyr pieces: discovering the west workspace, enumerating the Zephyr kernel
// + west manifest projects (`west list`), and resolving each one's LICENSE.
//
// Scoping mirrors framework-arduino's `--all` distinction:
//   - default (project scope): only the dependencies the firmware ACTUALLY
//     links, derived from the build's `compile_commands.json` (a module is
//     listed iff its sources were compiled). A west manifest carries every
//     vendor HAL/library; almost none are linked by a single project, so the
//     default filters them out. Requires a prior `typecad-hal build` — without
//     one, only the kernel is reported with a hint to build first.
//   - `--all`: every west manifest project (the whole workspace).
//
// Mirrors framework-arduino's presenter shape (runLicensesPresenter(strict,
// all); never calls process.exit(); sets process.exitCode under --strict).
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as ui from '@typecad/cuttlefish/utils/ui';
import { loadTypecadConfig } from '@typecad/cuttlefish/config-loader';
import {
  resolveLibraryLicense,
  RISK_RANK,
  riskBracket,
  statusMark,
  countByRisk,
  type LibraryLicenseEntry,
  type ReadFile,
  type ReadDir,
} from '@typecad/cuttlefish/api/shared';
import { discoverWest } from './toolchain/west-discover.js';
import { westSpawn } from './toolchain/west-spawn.js';

// ---------------------------------------------------------------------------
// Outcome + runner types
// ---------------------------------------------------------------------------

export type ZephyrLicensesOutcome =
  | { ok: true; entries: LibraryLicenseEntry[]; needsBuild?: boolean }
  | {
      ok: false;
      reason: 'west-not-found' | 'no-workspace' | 'no-dependencies';
      message: string;
    };

/**
 * Injected enumeration seams so scanZephyrLicenses is unit-testable without
 * spawning west or touching disk. The production runner (defaultRunner) wires
 * these to discoverWest + westSpawn + fs.
 */
export interface ZephyrLicensesRunner {
  /** Absolute workspace topdir, or null if cwd is not inside a west workspace. */
  topdir: () => string | null;
  /** west manifest projects `[{ name, abspath }]`, or null if `west list` failed. */
  listModules: () => { name: string; abspath: string }[] | null;
  /** Discovered $ZEPHYR_BASE (absolute), or undefined. */
  zephyrBase?: string;
  /**
   * The build's compile_commands.json text, or null when no build exists. The
   * project scope uses it to determine which modules the firmware actually
   * links (a module is "linked" iff one of its sources was compiled).
   */
  compileCommands?: () => string | null;
  readFile: ReadFile;
  readdir: ReadDir;
}

// ---------------------------------------------------------------------------
// Linked-module filtering (project scope)
// ---------------------------------------------------------------------------

/** Normalize a path for case-insensitive, separator-agnostic comparison. */
function norm(p: string): string {
  return p.split('\\').join('/').toLowerCase();
}

/**
 * Filter the west manifest to the modules whose sources were compiled in the
 * last build. A module is "linked" iff some compiled translation unit lives
 * under its abspath. If the build data is unparseable, no filtering is applied
 * (degrade to listing all modules rather than reporting nothing).
 */
function filterLinkedModules(
  ccText: string,
  modules: { name: string; abspath: string }[],
): { name: string; abspath: string }[] {
  let arr: unknown;
  try {
    arr = JSON.parse(ccText);
  } catch {
    return modules;
  }
  if (!Array.isArray(arr)) return modules;
  // One normalized blob of every compiled source path; membership is then a
  // substring check per module (O(modules) after an O(TUs) join).
  const blob = arr
    .map((e) => norm(typeof (e as { file?: unknown })?.file === 'string' ? (e as { file: string }).file : ''))
    .join('\n');
  return modules.filter((m) => blob.includes(norm(m.abspath) + '/'));
}

// ---------------------------------------------------------------------------
// scanZephyrLicenses — enumerate + resolve the workspace dependency set
// ---------------------------------------------------------------------------

/**
 * Resolve the Zephyr kernel + west manifest projects to license entries.
 *
 * The Zephyr kernel is always included (when ZEPHYR_BASE is known) — a
 * cuttlefish app always links it via `find_package(Zephyr)`.
 *
 * `all === false` (default, project scope) filters the west modules to those
 * whose sources were compiled in the last build (via `compileCommands`). When
 * no build is available, only the kernel is returned and `needsBuild` is set so
 * the presenter can hint the user to build first. Never throws.
 */
export function scanZephyrLicenses(
  runner: ZephyrLicensesRunner,
  all = false,
): ZephyrLicensesOutcome {
  const { readFile, readdir } = runner;
  const entries: LibraryLicenseEntry[] = [];

  // 1. The Zephyr kernel ($ZEPHYR_BASE). Apache-2.0; resolved from its LICENSE.
  if (runner.zephyrBase) {
    entries.push(
      resolveLibraryLicense(
        { name: 'zephyr (kernel)', installDir: runner.zephyrBase },
        readFile,
        readdir,
        // Zephyr's top-level LICENSE is the authoritative source; no manifest
        // license field to consult, and scanning its source headers is noise.
        { subdirs: [] },
      ),
    );
  }

  // 2. west manifest projects.
  const modules = runner.listModules();
  if (modules === null) {
    if (entries.length > 0) return { ok: true, entries };
    return {
      ok: false,
      reason: 'no-workspace',
      message: '`west list` did not return a project list (not inside a west workspace?).',
    };
  }

  // Project scope: keep only the modules the build actually linked.
  let projectModules = modules;
  let needsBuild = false;
  if (!all) {
    const cc = runner.compileCommands ? runner.compileCommands() : null;
    if (cc === null) {
      // No build — can't determine the linked set. Report the kernel only and
      // flag it so the presenter prints a "build first" hint.
      projectModules = [];
      needsBuild = true;
    } else {
      projectModules = filterLinkedModules(cc, modules);
    }
  }

  for (const m of projectModules) {
    // Skip the Zephyr kernel itself (already added above by name) to avoid a
    // duplicate row when it is also a manifest project.
    if (runner.zephyrBase && path.resolve(m.abspath) === path.resolve(runner.zephyrBase)) {
      continue;
    }
    entries.push(
      resolveLibraryLicense({ name: m.name, installDir: m.abspath }, readFile, readdir, {
        // Zephyr HAL modules commonly keep their LICENSE under a `zephyr/` or
        // `src/` subdir (e.g. hal_nordic ships zephyr/LICENSE.txt). Check both
        // alongside the root. (Source-header scanning is bounded — it only runs
        // when no LICENSE file is found, capped at 6 files / 120 lines.)
        subdirs: ['zephyr', 'src'],
      }),
    );
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'no-dependencies',
      message: 'No Zephyr dependencies found to scan.',
    };
  }

  entries.sort((a, b) => {
    const r = RISK_RANK[a.risk] - RISK_RANK[b.risk];
    if (r !== 0) return r;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return { ok: true, entries, needsBuild };
}

// ---------------------------------------------------------------------------
// Default runner — wires seams to discoverWest + westSpawn + fs
// ---------------------------------------------------------------------------

/**
 * Find the build's compile_commands.json under cwd. Cuttlefish's Zephyr project
 * root is the transpile output dir (e.g. `<cwd>/src/out`), so the build dir is
 * `<root>/build` — not necessarily `<cwd>/build`. Check the common layouts,
 * then fall back to a bounded search (skipping node_modules/.git/dist).
 */
function findCompileCommandsText(readFile: ReadFile, readdir: ReadDir): string | null {
  const direct = [
    path.join(process.cwd(), 'build', 'compile_commands.json'),
    path.join(process.cwd(), 'out', 'build', 'compile_commands.json'),
    path.join(process.cwd(), 'src', 'out', 'build', 'compile_commands.json'),
  ];
  for (const c of direct) {
    const text = readFile(c);
    if (text) return text;
  }
  // Bounded recursive search for a build/compile_commands.json.
  const isCc = (p: string) => {
    const n = norm(p);
    return n.endsWith('/build/compile_commands.json') || n.endsWith('\\build\\compile_commands.json');
  };
  let found: string | undefined;
  const seen = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (found || depth > 4 || seen.has(dir)) return;
    seen.add(dir);
    let entries: string[];
    try {
      entries = readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      if (e === 'compile_commands.json' && isCc(full)) {
        found = full;
        return;
      }
    }
    for (const e of entries) {
      if (found) return;
      if (e === 'node_modules' || e === '.git' || e === 'dist' || e.startsWith('.')) continue;
      walk(path.join(dir, e), depth + 1);
    }
  };
  walk(process.cwd(), 0);
  return found ? (readFile(found) ?? null) : null;
}

function defaultRunner(): ZephyrLicensesRunner | null {
  const install = discoverWest();
  if (!install) return null;
  const zephyrBase = install.zephyrBase;

  // `west topdir` prints the workspace root (one path line). Returns null when
  // cwd is not inside a west workspace (west exits non-zero).
  const topdir = (): string | null => {
    try {
      const inv = westSpawn(['topdir'], { encoding: 'utf8', timeout: 15_000 });
      const r = spawnSync(inv.command, inv.args, inv.options);
      const out = typeof r.stdout === 'string' ? r.stdout.trim() : '';
      return r.status === 0 && out ? out : null;
    } catch {
      return null;
    }
  };

  // `west list --format '{name}\t{abspath}'` → one project per line. Returns
  // null on any spawn failure.
  const listModules = (): { name: string; abspath: string }[] | null => {
    try {
      const inv = westSpawn(['list', '--format', '{name}\t{abspath}'], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      const r = spawnSync(inv.command, inv.args, inv.options);
      if (r.status !== 0) return null;
      const out = typeof r.stdout === 'string' ? r.stdout : '';
      const mods: { name: string; abspath: string }[] = [];
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [name, abspath] = trimmed.split('\t');
        if (name && abspath) mods.push({ name, abspath });
      }
      return mods;
    } catch {
      return null;
    }
  };

  const readFile: ReadFile = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  };
  const readdir: ReadDir = (d) => {
    try {
      return readdirSync(d);
    } catch {
      return [];
    }
  };

  return {
    topdir,
    listModules,
    zephyrBase,
    compileCommands: () => findCompileCommandsText(readFile, readdir),
    readFile,
    readdir,
  };
}

// ---------------------------------------------------------------------------
// CLI presenter
// ---------------------------------------------------------------------------

let testRunner: ZephyrLicensesRunner | null | undefined;

/** @internal Test-only override of the default runner. Pass null to simulate west-not-found. */
export function __setLicensesRunnerForTest(runner: ZephyrLicensesRunner | null | undefined): void {
  testRunner = runner;
}

/**
 * `typecad-hal licenses` (Zephyr) presenter. Enumerates the Zephyr kernel +
 * west manifest projects, resolves each one's license, classifies copyleft
 * risk, and renders a sorted table. Warns on unknown licenses; sets
 * process.exitCode under --strict when any strong-copyleft dependency is
 * present. Never calls process.exit().
 *
 * Default scope = only the modules the firmware actually links (from the last
 * `typecad-hal build`); `--all` lists every west manifest module.
 */
export function runLicensesPresenter(strict: boolean, all: boolean): void {
  ui.printHeader();
  ui.printStep(
    all
      ? 'Checking licenses for every west manifest module'
      : 'Checking licenses for this Zephyr project (linked dependencies only)',
  );

  // Surface the config (informational). Best-effort: a missing/malformed config
  // never blocks the license scan.
  let buildTarget: string | undefined;
  try {
    buildTarget = loadTypecadConfig(process.cwd())?.buildTarget;
  } catch {
    /* best-effort */
  }
  if (buildTarget) {
    ui.printInfo(`Board target ... ${buildTarget}`);
  }

  const runner = testRunner !== undefined ? testRunner : defaultRunner();
  if (!runner) {
    ui.printError('west ............. NOT FOUND');
    ui.printInfo("  → install west (pip install west) or run the typeCAD Zephyr installer.");
    process.exitCode = 1;
    return;
  }

  const result = scanZephyrLicenses(runner, all);
  if (!result.ok) {
    if (result.reason === 'no-workspace' || result.reason === 'no-dependencies') {
      ui.printInfo(`(${result.message})`);
    }
    return;
  }

  // Project scope with no build: only the kernel is reported. Hint the user to
  // build (which records which modules actually link) or use --all.
  if (result.needsBuild) {
    ui.printInfo(
      '(no build found — only the Zephyr kernel is shown. Run `typecad-hal build` to scope ' +
        'this report to the modules your firmware actually links, or use `typecad-hal licenses --all` ' +
        'for every west module.)',
    );
  }

  const counts = countByRisk(result.entries);
  for (const e of result.entries) {
    if (e.risk === 'unknown') {
      ui.printWarning(`${e.name} .................. UNKNOWN`);
    } else {
      ui.printInfo(`${e.name} .................. ${e.spdx ?? 'UNKNOWN'}${riskBracket(e.risk)}${statusMark(e.risk)}`);
    }
  }
  ui.printSuccess(
    `${counts.permissive} permissive, ${counts['weak-copyleft']} weak copyleft, ` +
      `${counts['strong-copyleft']} strong copyleft, ${counts.unknown} unknown`,
  );

  const unknowns = result.entries.filter((e) => e.risk === 'unknown');
  if (unknowns.length > 0) {
    ui.printWarning(
      `License could not be determined for ${unknowns.length} ${unknowns.length === 1 ? 'dependency' : 'dependencies'}:`,
    );
    for (const u of unknowns) {
      ui.printInfo(`    ${u.name} (check LICENSE in ${u.path})`);
    }
  }

  const strongCopyleft = result.entries.filter((e) => e.risk === 'strong-copyleft');
  if (strongCopyleft.length > 0) {
    ui.printWarning(
      `${strongCopyleft.length} ${strongCopyleft.length === 1 ? 'dependency carries' : 'dependencies carry'} strong-copyleft terms — review before shipping.`,
    );
  }

  // --strict fails the build on any unknown OR strong-copyleft dependency.
  if ((unknowns.length > 0 || strongCopyleft.length > 0) && strict) {
    process.exitCode = 1;
  }
}
