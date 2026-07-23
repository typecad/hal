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
const workspaces = rootPkg.workspaces.map((w) => w.replace('packages/', ''));

// Build {pkg -> [runtime @typecad deps that are workspaces]}.
const graph = {};
for (const pkg of workspaces) {
  const p = JSON.parse(readFileSync(resolve(root, 'packages', pkg, 'package.json'), 'utf8'));
  const deps = Object.keys(p.dependencies ?? {})
    .filter((k) => k.startsWith('@typecad/'))
    .map((k) => k.replace('@typecad/', ''))
    .filter((d) => workspaces.includes(d));
  graph[pkg] = deps;
}

// Kahn's algorithm. Ties broken alphabetically for determinism.
const indeg = Object.fromEntries(workspaces.map((w) => [w, 0]));
const adj = Object.fromEntries(workspaces.map((w) => [w, []]));
for (const n of workspaces) {
  for (const d of graph[n]) {
    // n depends on d → edge d → n (d must build before n).
    adj[d].push(n);
    indeg[n]++;
  }
}
const queue = workspaces.filter((w) => indeg[w] === 0).sort();
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

if (order.length !== workspaces.length) {
  const cyclic = workspaces.filter((w) => !order.includes(w));
  console.error('Build error: dependency cycle detected among:', cyclic.join(', '));
  for (const n of cyclic) console.error(`  ${n} -> ${graph[n].join(', ')}`);
  process.exit(1);
}

console.log(`Building ${order.length} workspaces in topological order:`);
console.log('  ' + order.join(' → '));
console.log('');

for (const pkg of order) {
  const p = JSON.parse(readFileSync(resolve(root, 'packages', pkg, 'package.json'), 'utf8'));
  if (!p.scripts?.build) continue; // skip packages without a build script
  process.stdout.write(`▸ @typecad/${pkg} ... `);
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: resolve(root, 'packages', pkg) });
    console.log('ok');
  } catch {
    console.error(`\n✗ @typecad/${pkg} build failed`);
    process.exit(1);
  }
}
console.log('\n✓ All workspaces built.');
