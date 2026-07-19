import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ComponentScanRoots {
  /** Subdirectory names under managed_components/ (e.g. espressif__esp_wifi). */
  managed: string[];
  /** Absolute paths to local component directories. */
  local: string[];
  /**
   * ESP-IDF built-in component names (e.g. esp_wifi). Resolved against
   * `idfRoot/components/<name>/include/` when idfRoot is provided; ignored
   * otherwise (the caller is responsible for passing idfRoot when builtins
   * are present).
   */
  builtin: string[];
  /** Optional ESP-IDF install root for resolving `builtin` names. */
  idfRoot?: string;
}

/**
 * A discovered header plus the directory its generated .d.ts should land in.
 *
 * `outputDir` is alongside the header for managed/local components (so the
 * .d.ts lives in the same gitignored component dir, regenerated on each run).
 * For built-in components it's a project-local cache — NEVER write into the
 * IDF install itself.
 */
export interface DiscoveredHeader {
  /** Absolute path to the source .h file. */
  path: string;
  /** Absolute directory where the generated .d.ts should be written. */
  outputDir: string;
}

/** Walk a directory recursively, returning all .h files. */
function walkHeaders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else if (name.toLowerCase().endsWith('.h')) {
          out.push(full);
        }
      } catch {
        // Stat failed (race); skip.
      }
    }
  }
  return out;
}

/**
 * Find all .h files for the declared components.
 *
 * - managed: scan `managed_components/<name>/include/` (falling back to the
 *   component dir if no include/ exists). Populated by `idf.py reconfigure`.
 * - local: scan `<path>/include/` (or `<path>/`).
 * - builtin: scan `<idfRoot>/components/<name>/include/` (IDF ships with these).
 *
 * For builtins the output .d.ts goes to `<projectDir>/.cuttlefish/component-decls/<component>/`
 * — never into `$IDF_PATH/components/`, which would pollute the IDF install.
 *
 * Returned entries are unsorted — the caller decides ordering.
 */
export function discoverComponentHeaders(
  projectDir: string,
  roots: ComponentScanRoots,
): DiscoveredHeader[] {
  const headers: DiscoveredHeader[] = [];

  for (const name of roots.managed) {
    const base = join(projectDir, 'managed_components', name);
    const includeDir = join(base, 'include');
    const dir = existsSync(includeDir) ? includeDir : base;
    for (const h of walkHeaders(dir)) {
      headers.push({ path: h, outputDir: dir });
    }
  }

  for (const localPath of roots.local) {
    const includeDir = join(localPath, 'include');
    const dir = existsSync(includeDir) ? includeDir : localPath;
    for (const h of walkHeaders(dir)) {
      headers.push({ path: h, outputDir: dir });
    }
  }

  if (roots.idfRoot) {
    for (const name of roots.builtin) {
      const base = join(roots.idfRoot, 'components', name);
      const includeDir = join(base, 'include');
      const dir = existsSync(includeDir) ? includeDir : base;
      // Project-local cache for builtins. Mirrors the include/ layout so
      // imports can substitute `managed_components/<name>/include/X.d.ts`
      // patterns. Each header's .d.ts is named after the header basename.
      const outDir = join(projectDir, '.cuttlefish', 'component-decls', name);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      for (const h of walkHeaders(dir)) {
        headers.push({ path: h, outputDir: outDir });
      }
    }
  }

  return headers;
}
