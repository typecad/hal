import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScaffoldComponents } from './types.js';

const HASH_FILENAME = '.cuttlefish-deps-hash';

/**
 * Deterministic hash of the resolved components payload. Managed deps are
 * sorted by name so declaration order doesn't spuriously invalidate the
 * cache. Local deps keep their declared order (they map 1:1 to
 * EXTRA_COMPONENT_DIRS lines, whose order doesn't matter functionally but
 * is preserved for stability).
 */
export function hashForComponents(components: ScaffoldComponents): string {
  const managedEntries = Object.entries(components.managed).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const payload = JSON.stringify({
    managed: managedEntries, // sorted
    local: components.local,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/** True when the on-disk hash differs from (or doesn't exist for) `components`. */
export function depsHashChanged(projectDir: string, components: ScaffoldComponents): boolean {
  const hashPath = join(projectDir, 'build', HASH_FILENAME);
  if (!existsSync(hashPath)) return true;
  const prev = readFileSync(hashPath, 'utf8').trim();
  return prev !== hashForComponents(components);
}

/** Persist the current components hash so the next run can skip reconfigure. */
export function writeDepsHash(projectDir: string, components: ScaffoldComponents): void {
  const buildDir = join(projectDir, 'build');
  if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });
  const hashPath = join(buildDir, HASH_FILENAME);
  writeFileSync(hashPath, hashForComponents(components), 'utf8');
}
