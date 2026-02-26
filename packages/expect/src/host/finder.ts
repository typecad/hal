// ---------------------------------------------------------------------------
// @typecode/expect — Test file finder
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
 * @param projectRoot  Absolute path to the project root.
 * @param include      Glob patterns to match (e.g. `['tests/**\/*.test.ts']`).
 * @returns Absolute paths to found test files, sorted alphabetically.
 */
export function findTestFiles(projectRoot: string, include: string[]): string[] {
  const results: string[] = [];

  for (const pattern of include) {
    // Simple glob expansion — supports ** and * patterns
    const files = expandGlob(projectRoot, pattern);
    for (const f of files) {
      if (!results.includes(f)) {
        results.push(f);
      }
    }
  }

  results.sort();
  return results;
}

// ---------------------------------------------------------------------------
// Internal — Simple glob expansion
//
// Avoids adding a glob dependency by handling the common patterns:
//   **/*.test.ts   — recursive, match suffix
//   tests/*.ts     — single directory, match suffix
//   tests/foo.ts   — exact file
// ---------------------------------------------------------------------------

function expandGlob(root: string, pattern: string): string[] {
  // Normalize separators
  const normalized = pattern.replace(/\\/g, '/');

  if (normalized.includes('**')) {
    return expandDoubleStarGlob(root, normalized);
  }

  if (normalized.includes('*')) {
    return expandSingleStarGlob(root, normalized);
  }

  // Exact file
  const exact = path.resolve(root, normalized);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return [exact];
  }
  return [];
}

function expandDoubleStarGlob(root: string, pattern: string): string[] {
  // Split on ** — e.g. "tests/**/*.test.ts" → prefix="tests", suffix="*.test.ts"
  const [prefix, ...rest] = pattern.split('**/');
  const suffix = rest.join('**/'); // rejoin in case of multiple **

  const baseDir = path.resolve(root, prefix);
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    return [];
  }

  const results: string[] = [];
  walkDir(baseDir, (filePath) => {
    const relative = path.relative(baseDir, filePath).replace(/\\/g, '/');
    if (matchWildcard(relative, suffix)) {
      results.push(filePath);
    }
  });

  return results;
}

function expandSingleStarGlob(root: string, pattern: string): string[] {
  const dir = path.dirname(pattern);
  const filePattern = path.basename(pattern);
  const absDir = path.resolve(root, dir);

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    return [];
  }

  const results: string[] = [];
  for (const entry of fs.readdirSync(absDir)) {
    if (matchWildcard(entry, filePattern)) {
      const fullPath = path.join(absDir, entry);
      if (fs.statSync(fullPath).isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

/**
 * Match a filename against a simple wildcard pattern.
 * Supports `*` as any-characters and `?` as single-character.
 */
function matchWildcard(filename: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(filename);
}
