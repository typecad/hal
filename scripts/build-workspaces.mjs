#!/usr/bin/env node
// Build all workspace packages in topological (dependency) order.
//
// `npm run build --workspaces` runs in package.json listing order, which does
// not match the dependency graph: cuttlefish is listed first but depends on
// arduino-cli and framework-arduino, so it builds before its own dependencies'
// dist/ exists and fails with TS2307 "Cannot find module" errors. This script
// reads each workspace's runtime `dependencies`, computes a topological order,
// and runs each package's `build` script sequentially so a package's deps are
// always built first.
//
// devDependencies are intentionally excluded — they are not build-order inputs
// for the published library (e.g. hal's devDependency on board-arduino-uno is
// for its hardware-test harness, not for compiling src/).

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// Each workspace entry is a path relative to the repo root (e.g.
// 'packages/cuttlefish', 'boards/board-esp32s3', 'mcus/mcu-esp32s3'). The
// package's directory name is the last path segment. We key everything by that
// name so dependency lookups (@typecad/<name>) match across the graph, while
// keeping the original relative path for filesystem resolution.
//
// Note: npm workspace entries may also be globs (e.g. 'packages/*'); we expand
// none here because this monorepo lists each package explicitly. If globs are
// introduced, expand them with glob.sync before building the map.
const workspaces = rootPkg.workspaces;
const dirByName = new Map();        // <pkg-dir-name> -> <rel path from root>
const nameByDir = new Map();        // <rel path>     -> <pkg-dir-name>
for (const rel of workspaces) {
  const dir = rel.split('/').pop();
  dirByName.set(dir, rel);
  nameByDir.set(rel, dir);
}

const readPkg = (rel) =>
  JSON.parse(readFileSync(resolve(root, rel, 'package.json'), 'utf8'));

// Build {pkg dir -> [runtime @typecad deps that are workspaces]}.
const graph = {};
for (const rel of workspaces) {
  const dir = nameByDir.get(rel);
  const p = readPkg(rel);
  const deps = Object.keys(p.dependencies ?? {})
    .filter((k) => k.startsWith('@typecad/'))
    .map((k) => k.replace('@typecad/', ''))
    .filter((d) => dirByName.has(d));
  graph[dir] = deps;
}

const dirs = [...dirByName.keys()];

// Kahn's algorithm. Ties broken alphabetically for determinism.
const indeg = Object.fromEntries(dirs.map((w) => [w, 0]));
const adj = Object.fromEntries(dirs.map((w) => [w, []]));
for (const n of dirs) {
  for (const d of graph[n]) {
    // n depends on d → edge d → n (d must build before n).
    adj[d].push(n);
    indeg[n]++;
  }
}
const queue = dirs.filter((w) => indeg[w] === 0).sort();
const order = [];
while (queue.length) {
  const n = queue.shift();
  order.push(n);
  const ready = [];
  for (const m of adj[n]) {
    if (--indeg[m] === 0) ready.push(m);
  }
  queue.push(...ready.sort());
  queue.sort();
}

if (order.length !== dirs.length) {
  const cyclic = dirs.filter((w) => !order.includes(w));
  console.error('Build error: dependency cycle detected among:', cyclic.join(', '));
  for (const n of cyclic) console.error(`  ${n} -> ${graph[n].join(', ')}`);
  process.exit(1);
}

console.log(`Building ${order.length} workspaces in topological order:`);
console.log('  ' + order.join(' → '));
console.log('');

for (const dir of order) {
  const rel = dirByName.get(dir);
  const p = readPkg(rel);
  if (!p.scripts?.build) continue; // skip packages without a build script
  process.stdout.write(`▸ @typecad/${dir} ... `);
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: resolve(root, rel) });
    console.log('ok');
  } catch {
    console.error(`\n✗ @typecad/${dir} build failed`);
    process.exit(1);
  }
}
console.log('\n✓ All workspaces built.');
