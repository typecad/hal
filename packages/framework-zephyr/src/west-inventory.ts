// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — shared west workspace ground truth
//
// The as-built inventory both `typecad-hal licenses` and `typecad-hal sbom`
// report from: which west manifest modules the last build ACTUALLY compiled
// (linked-module filtering via the build's compile_commands.json), plus the
// build-directory discovery that locates it. A west manifest carries every
// vendor HAL/library; almost none are linked by a single project — both the
// license table and the SBOM scope to the linked set by default, so they stay
// honest about what is actually inside the firmware.
//
// Moved out of licenses.ts when the sbom command grew a second consumer; the
// behavior (case-insensitive, separator-agnostic path matching; degrade to
// "no filtering" on unparseable build data) is unchanged.
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import type { ReadDir, ReadFile } from '@typecad/cuttlefish/api/shared';

/** Normalize a path for case-insensitive, separator-agnostic comparison. */
export function norm(p: string): string {
  return p.split('\\').join('/').toLowerCase();
}

/**
 * Filter the west manifest to the modules whose sources were compiled in the
 * last build. A module is "linked" iff some compiled translation unit lives
 * under its abspath. If the build data is unparseable, no filtering is applied
 * (degrade to listing all modules rather than reporting nothing).
 */
export function filterLinkedModules(
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

/**
 * Find the build's compile_commands.json path under `cwd`. Cuttlefish's Zephyr
 * project root is the transpile output dir (e.g. `<cwd>/src/out`), so the
 * build dir is `<root>/build` — not necessarily `<cwd>/build`. Check the
 * common layouts, then fall back to a bounded search (skipping
 * node_modules/.git/dist and dot-directories). Returns the PATH (the caller
 * decides whether to read it); undefined when no build exists.
 */
export function findCompileCommandsPath(
  readFile: ReadFile,
  readdir: ReadDir,
  cwd = process.cwd(),
): string | undefined {
  const direct = [
    path.join(cwd, 'build', 'compile_commands.json'),
    path.join(cwd, 'out', 'build', 'compile_commands.json'),
    path.join(cwd, 'src', 'out', 'build', 'compile_commands.json'),
  ];
  for (const c of direct) {
    if (readFile(c)) return c;
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
  walk(cwd, 0);
  return found;
}
