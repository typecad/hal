// ---------------------------------------------------------------------------
// Trace preflight — fail fast (with the remedy) instead of burning a capture
// duration against firmware that was never built with tracing.
//
// The agent-friendly contract: `trace capture` checks the LAST build's merged
// Kconfig (the same ground truth `audit` reads) for the sampler's symbols
// BEFORE opening the port. An untraced build exits 2 with the exact rebuild
// command; a missing build dir only warns (the firmware may have been built
// elsewhere — the zero-sample guidance at capture end still covers it).
//
// Also here: the --gates-file loader (committed thresholds, the
// audit-waivers.json pattern) and the lone-port auto-pick decision.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';

/** The Kconfig symbols the heartbeat sampler needs (see scaffold.ts). */
export const TRACE_KCONFIG_SYMBOLS = [
  'CONFIG_THREAD_RUNTIME_STATS',
  'CONFIG_THREAD_MONITOR',
] as const;

/** Does a merged .config carry the trace sampler's symbols? */
export function isTracedBuildConfig(configText: string): boolean {
  return TRACE_KCONFIG_SYMBOLS.every((sym) => new RegExp(`^${sym}=y$`, 'm').test(configText));
}

/** Locate the last build's merged zephyr/.config under cwd — the direct
 *  outDir layouts first, then a bounded walk (skipping the heavy dirs).
 *  Undefined when no build exists. */
export function findBuildConfig(cwd: string = process.cwd()): string | undefined {
  const direct = ['build', 'out/build', 'src/out/build']
    .map((rel) => path.join(cwd, rel, 'zephyr', '.config'));
  for (const c of direct) {
    if (existsSync(c)) return c;
  }
  const skip = new Set(['node_modules', '.git', '.typecad-hal', '.vscode']);
  let found: string | undefined;
  const seen = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (found !== undefined || depth > 3 || seen.has(dir)) return;
    seen.add(dir);
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found !== undefined) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        // The build dir itself: check for its merged config directly.
        if (e.name === 'build' && existsSync(path.join(full, 'zephyr', '.config'))) {
          found = path.join(full, 'zephyr', '.config');
          return;
        }
        walk(full, depth + 1);
      }
    }
  };
  walk(cwd, 0);
  return found;
}

/** Preflight verdict for capture (discriminated on `status`). */
export type PreflightResult =
  /** No build directory found — capture proceeds with a warning. */
  | { status: 'no-build' }
  /** Build found and carries the sampler symbols. */
  | { status: 'traced'; configPath: string }
  /** Build found but untraced — capture must not run (exit 2 + remedy). */
  | { status: 'untraced'; configPath: string };

export function preflightTracedBuild(cwd: string = process.cwd()): PreflightResult {
  const configPath = findBuildConfig(cwd);
  if (configPath === undefined) return { status: 'no-build' };
  try {
    const text = readFileSync(configPath, 'utf8');
    return isTracedBuildConfig(text)
      ? { status: 'traced', configPath }
      : { status: 'untraced', configPath };
  } catch {
    return { status: 'no-build' };
  }
}

/** Load a gates file: either `{ "gates": ["cpu-avg:main<=50", ...] }` or a
 *  bare array. Throws with context on anything else. */
export function parseGatesFile(text: string, filePath: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cannot read gates file ${filePath}: ${(err as Error).message}`);
  }
  const list = Array.isArray(raw)
    ? raw
    : (raw as { gates?: unknown }).gates;
  if (!Array.isArray(list) || list.some((g) => typeof g !== 'string')) {
    throw new Error(`${filePath} must be a JSON array of gate strings or { "gates": [...] }.`);
  }
  return list as string[];
}

/** Auto-pick decision for --port: an unambiguous single attached port is
 *  usable without asking; anything else needs an explicit port. */
export function pickAutoPort(ports: readonly string[]): string | undefined {
  return ports.length === 1 ? ports[0] : undefined;
}
