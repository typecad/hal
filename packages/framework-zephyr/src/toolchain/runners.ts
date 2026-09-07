// ---------------------------------------------------------------------------
// runners.ts — read west's resolved runner facts from a built Zephyr tree.
//
// After any successful `west build`, Zephyr writes build/zephyr/runners.yaml —
// the FULLY RESOLVED debug/flash configuration for the board: the arch gdb
// binary, the openocd binary + its script search dirs, the jlink device name,
// the board's declared default debug runner. It is the single source of debug
// truth west itself uses (`west debug` / `west debugserver` read the same
// file), so cuttlefish reads it instead of reconstructing any of this.
//
// The parser below is deliberately minimal: it understands exactly the shape
// west's run_common.py emits — top-level scalars, a list section whose items
// sit at column 0, and a nested config map — and ignores everything else
// (e.g. the args section). A general YAML dependency is not worth it for one
// machine-generated file.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import { join } from 'node:path';

export interface RunnersFacts {
  /** The board's declared default debug runner (e.g. 'openocd', 'jlink'). */
  readonly debugRunner?: string;
  /** Absolute path to the arch gdb binary (config.gdb). */
  readonly gdb?: string;
  /** All runners the board configured. */
  readonly runners: readonly string[];
}

/**
 * Parse the subset of runners.yaml cuttlefish consumes. Exported for tests.
 * Returns undefined on shapes it does not understand (callers treat as
 * "no facts" — never crash a build over diagnostics data).
 */
export function parseRunnersYaml(text: string): RunnersFacts | undefined {
  const runners: string[] = [];
  let debugRunner: string | undefined;
  let gdb: string | undefined;
  // Section state: '' = top level, 'runners' = the list, 'config' = the map.
  let section: '' | 'runners' | 'config' = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // List items — west writes the runners list at column 0 and
    // openocd_search indented; both belong to the last-opened section.
    if (trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      if (section === 'runners') runners.push(item);
      continue; // other sections' lists (openocd_search, args) are unused
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const m = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue; // e.g. west's empty-list `[]` lines — skip, don't bail

    const [, key, value] = m;
    if (indent === 0) {
      if (key === 'runners') { section = 'runners'; continue; }
      if (key === 'config') { section = 'config'; continue; }
      section = '';
      if (key === 'debug-runner' && value) debugRunner = value.trim();
      continue;
    }
    if (section === 'config' && key === 'gdb' && value) {
      gdb = value.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return { runners, ...(debugRunner ? { debugRunner } : {}), ...(gdb ? { gdb } : {}) };
}

/** Read the resolved runner facts for a build dir. undefined when absent/unparseable. */
export function readRunnersFacts(buildDir: string): RunnersFacts | undefined {
  try {
    return parseRunnersYaml(fs.readFileSync(join(buildDir, 'zephyr', 'runners.yaml'), 'utf-8'));
  } catch {
    return undefined;
  }
}
