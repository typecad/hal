// ---------------------------------------------------------------------------
// cuttlefish test-runner — Test file finder
//
// Globs for test files matching the configured include patterns.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find all test files matching the include glob patterns.
 *
 * Supports patterns like `tests/**\/*.test.ts`, `src/**\/*.test.ts`, or exact
 * file paths like `src/main.ts`.  Only files ending in `.test.ts` are
 * returned.
 *
 * @param projectRoot  Absolute path to the project root.
 * @param include      Glob patterns to match.
 * @returns Absolute paths to found test files, sorted alphabetically.
 */
export function findTestFiles(projectRoot: string, include: string[]): string[] {
  const seen = new Set<string>();

  for (const pattern of include) {
    for (const f of expandPattern(projectRoot, pattern)) {
      if (f.endsWith('.test.ts') && !seen.has(f)) {
        seen.add(f);
      }
    }
  }

  return [...seen].sort();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function expandPattern(projectRoot: string, pattern: string): string[] {
  const normalized = pattern.replace(/\\/g, '/');

  // Exact file path (no wildcards)
  if (!normalized.includes('*')) {
    const abs = path.resolve(projectRoot, normalized);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return [abs];
    return [];
  }

  // Split on the first ** or * to get directory prefix
  const starIdx = normalized.indexOf('*');
  const dirPart = normalized.slice(0, starIdx).replace(/\/$/, '');
  const absDir = path.resolve(projectRoot, dirPart || '.');

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];

  // Use recursive readdir, then match each relative path against the full pattern
  const regex = globToRegex(normalized.slice(dirPart ? dirPart.length + 1 : 0));
  const results: string[] = [];

  for (const entry of fs.readdirSync(absDir, { recursive: true })) {
    const rel = entry.toString().replace(/\\/g, '/');
    if (regex.test(rel) && rel.endsWith('.test.ts')) {
      const abs = path.resolve(absDir, rel);
      if (fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) {
        results.push(abs);
      }
    }
  }

  return results;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // **/ matches zero or more path segments, * matches within a single segment
  const pattern = escaped.replace(/\?/g, '[^/]').replace(/\*\*\//g, '(.+/)?').replace(/\*/g, '[^/]*');
  return new RegExp(`^${pattern}$`);
}
