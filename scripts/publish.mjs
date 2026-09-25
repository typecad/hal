// ---------------------------------------------------------------------------
// publish.mjs — the local publish command (`npm run publish`, run after
// `npx changeset version`). Releases are cut from a contributor machine,
// never CI — CI checkouts lack the gitignored staged-asset copies npm packs.
//
// Gates the npm publish on the bundled VS Code extension being fresh:
// sync:typecad-ui is idempotent — it compiles the extension from tracked
// source, stages the asset under packages/cuttlefish/assets/editor-
// extensions/ (out/, ui-language/, media/ incl. the gitignored mermaid
// bundle a fresh checkout lacks, manifest), rebuilds cuttlefish dist, and
// re-vendors the demos. Any git drift that leaves under the asset tree
// means someone changed the extension without syncing — fail the publish
// instead of shipping a stale extension (npm's `files` whitelist packs the
// tree verbatim, ignored files included, when they exist on disk).
//
// Usage:
//   npm run publish               # sync → drift gate → changeset publish
//   npm run publish -- --check-only  # sync + gate only, publish skipped
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join('packages', 'cuttlefish', 'assets');
const checkOnly = process.argv.includes('--check-only');

const run = (cmd) => {
  console.log(`> ${cmd}`);
  const r = spawnSync(cmd, { cwd: REPO, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`::error::command failed (exit ${r.status}): ${cmd}`);
    process.exit(1);
  }
};

run('npm run sync:typecad-ui');

const drift = spawnSync('git status --porcelain -- ' + ASSET_DIR, {
  cwd: REPO,
  shell: true,
  encoding: 'utf8',
}).stdout.trim();
if (drift) {
  console.error(`::error::${ASSET_DIR.replace(/\\/g, '/')} is stale — run 'npm run sync:typecad-ui' and commit the result`);
  console.error(drift);
  process.exit(1);
}
console.log('> bundled extension asset is fresh');

if (checkOnly) {
  console.log('> check-only: skipping changeset publish');
  process.exit(0);
}
run('npx changeset publish');
