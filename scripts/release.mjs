// ---------------------------------------------------------------------------
// release.mjs — one command, right order (mirrors the pcb repo's script so
// both typeCAD repos release the same way):
//
//   preflight → tests → changeset version → asset gate + changeset publish
//   → commit report
//
// The version bumps and the bundled-extension gate are ordered inside one
// script on purpose: `changeset publish` alone ships whatever state the
// staged asset tree is in, and the asset must be re-synced AFTER
// `changeset version` and BEFORE publish (scripts/publish.mjs enforces
// exactly that gate — this script just sequences it).
//
// Usage:
//   npm run release               # full sequence (needs `npm login` for publish)
//   npm run release -- --no-test  # skip the test gate
//   npm run release -- --dry-run  # show pending changesets, change nothing
//
// For a publish-only step after a manual `npx changeset version`, the gated
// entry stays: npm run publish (scripts/publish.mjs).
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run') || flags.has('-n');
const noTest = flags.has('--no-test');

const log = (m = '') => process.stdout.write(`${m}\n`);
const step = (m) => log(`\n== ${m} ${'='.repeat(Math.max(2, 66 - m.length))}`);
const die = (m) => {
  log(`\n✖ ${m}`);
  process.exit(1);
};

/** Run a shell command with inherited stdio; die on a non-zero exit. */
function run(cmd, cwd = root) {
  log(`\n$ (${path.relative(root, cwd) || '.'}) ${cmd}`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) die(`command failed (exit ${r.status}): ${cmd}`);
}

const git = (args, cwd = root) =>
  spawnSync(`git ${args}`, { cwd, shell: true, encoding: 'utf8' }).stdout.trim();

/** Pending changeset files — .changeset/*.md minus the README; `pre/` is a dir. */
const pendingChangesets = () =>
  fs.readdirSync(path.join(root, '.changeset')).filter((f) => f.endsWith('.md') && f !== 'README.md');

// -- 1. preflight ------------------------------------------------------------

step('preflight');
const branch = git('rev-parse --abbrev-ref HEAD');
if (branch !== 'main') log(`  warning: on branch '${branch}', not main (changesets baseBranch)`);
if (git('status --porcelain'))
  log('  warning: uncommitted changes — they ride into the release commit');
const pending = pendingChangesets();
if (pending.length === 0) {
  log('\nno pending changesets — nothing to release');
  process.exit(0);
}
log(`  ${pending.length} pending changeset(s)`);

if (dryRun) {
  step('dry run — pending changesets and their bumps');
  for (const file of pending) {
    const frontmatter = (fs.readFileSync(path.join(root, '.changeset', file), 'utf8').split('---')[1] ?? '')
      .split('\n')
      .filter((line) => line.includes(':'))
      .map((line) => line.trim())
      .join(', ');
    log(`  ${file}  [${frontmatter}]`);
  }
  log('\ndry run — no versions changed, nothing published');
  process.exit(0);
}

// -- 2. tests ----------------------------------------------------------------

if (noTest) {
  step('tests (skipped)');
} else {
  step('tests');
  run('npm test');
}

// -- 3. version ---------------------------------------------------------------
// Consume the changesets, then refresh package-lock.json so the bumped
// workspace versions are recorded — CI's `npm ci` fails on a stale lock.

step('changeset version (consume changesets, bump versions + changelogs)');
run('npx changeset version');
run('npm install --package-lock-only');

// -- 4+5. asset gate + publish -------------------------------------------------
// scripts/publish.mjs runs sync:typecad-ui, hard-aborts on any git drift it
// leaves under the staged asset tree (a stale extension must never ship),
// then runs changeset publish.

step('asset gate + changeset publish (npm, dependency order — needs `npm login`)');
run('node scripts/publish.mjs');

// -- 6. commit report ----------------------------------------------------------
// changesets is configured with commit:false — the bumps are committed by
// hand. Print the exact commands instead of running them: the commit also
// carries the consumed changesets, changelogs, and the refreshed lockfile,
// and changesets' git tags land in this repo.

step('commit the bumps — run these yourself');
if (git('status --porcelain')) {
  log('  umbrella repo (consumed changesets, changelogs, lockfile, version bumps):');
  log('    git add -A && git commit -m "Version Packages (pre-release)"');
  log(`    git push origin ${branch} --tags   # changesets tags land in this repo`);
}
log('\ndone.');
