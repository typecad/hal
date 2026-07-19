import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ComponentScanRoots {
  /** Subdirectory names under managed_components/ (e.g. espressif__esp_wifi). */
  managed: string[];
  /** Absolute paths to local component directories. */
  local: string[];
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
 * For each managed component: look in `managed_components/<name>/include/`,
 * falling back to `managed_components/<name>/` if no include/ subdir exists.
 * For each local component: same logic against the given path.
 *
 * Returned paths are absolute and unsorted — the caller decides ordering.
 */
export function discoverComponentHeaders(
  projectDir: string,
  roots: ComponentScanRoots,
): string[] {
  const headers: string[] = [];

  for (const name of roots.managed) {
    const base = join(projectDir, 'managed_components', name);
    const includeDir = join(base, 'include');
    const dir = existsSync(includeDir) ? includeDir : base;
    headers.push(...walkHeaders(dir));
  }

  for (const localPath of roots.local) {
    const includeDir = join(localPath, 'include');
    const dir = existsSync(includeDir) ? includeDir : localPath;
    headers.push(...walkHeaders(dir));
  }

  return headers;
}
