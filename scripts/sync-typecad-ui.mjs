// ---------------------------------------------------------------------------
// sync-typecad-ui.mjs — refresh every vendored copy of the editor extensions
//
// The bundled VS Code extensions live in packages/cuttlefish/assets/
// (source of truth, shipped with the npm package) and are vendored into
// workspaces via writeEditorIntegration. This script keeps all copies pinned:
//
//   1. compiles packages/vscode-typecad-debug and stages its build into
//      cuttlefish assets (the runtime pieces only — no devDependencies)
//   2. rebuilds @typecad/cuttlefish so dist matches src
//   3. re-runs writeEditorIntegration on the repo root and every demo with a
//      cuttlefish.config.ts (.vscode/extensions/, extensions.json, tasks.json)
//
// Run after changing the typecad-ui assets or the debug extension:
//   npm run sync:typecad-ui
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (cmd, cwd = REPO) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

// 1. Stage the debug extension build into cuttlefish assets.
run('npm run compile --workspace vscode-typecad-debug');
const DEBUG_SRC = path.join(REPO, 'packages/vscode-typecad-debug');
const DEBUG_DEST = path.join(REPO, 'packages/cuttlefish/assets/editor-extensions/typecad-debug');
fs.rmSync(DEBUG_DEST, { recursive: true, force: true });
fs.mkdirSync(path.join(DEBUG_DEST, 'out'), { recursive: true });
for (const file of ['out/extension.js', 'out/extension.js.map']) {
  fs.copyFileSync(path.join(DEBUG_SRC, file), path.join(DEBUG_DEST, file));
}
for (const file of ['package.json', 'README.md']) {
  fs.copyFileSync(path.join(DEBUG_SRC, file), path.join(DEBUG_DEST, file));
}
console.log(`staged typecad-debug -> ${path.relative(REPO, DEBUG_DEST)}`);

// 2. Rebuild cuttlefish so dist serves the current assets + integration code.
run('npm run build --workspace @typecad/cuttlefish');

// 3. Refresh the vendored copies (root + every demo workspace).
const { writeEditorIntegration } = await import(
  pathToFileUrl(path.join(REPO, 'packages/cuttlefish/dist/create/editor-integration.js'))
);
const { generateFrameworkDebugArtifacts } = await import(
  pathToFileUrl(path.join(REPO, 'packages/cuttlefish/dist/create/debug-artifacts.js'))
);

const targets = [REPO];
const demosDir = path.join(REPO, 'demos');
if (fs.existsSync(demosDir)) {
  for (const entry of fs.readdirSync(demosDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(demosDir, entry.name, 'cuttlefish.config.ts'))) {
      targets.push(path.join(demosDir, entry.name));
    }
  }
}

for (const target of targets) {
  const written = writeEditorIntegration(target);
  console.log(`${path.relative(REPO, target) || '.'} -> ${written.length} editor files refreshed`);

  // Debug artifacts (launch.json/tasks.json/openocd.cfg) — hand-assembled demos
  // never went through cuttlefish create's finalize step, so regenerate them
  // from each demo's config. No-ops for frameworks/targets without GDB support.
  const demo = path.relative(REPO, target);
  if (demo) {
    const cfg = fs.readFileSync(path.join(target, 'cuttlefish.config.ts'), 'utf-8');
    const framework = cfg.match(/framework:\s*'([^']+)'/)?.[1];
    const buildTarget = cfg.match(/buildTarget:\s*'([^']+)'/)?.[1];
    if (framework) {
      const debugWritten = generateFrameworkDebugArtifacts({ frameworkPackage: framework, workspaceRoot: target, buildTarget });
      if (debugWritten.length) console.log(`${demo} -> debug artifacts: ${debugWritten.join(', ')}`);
    }
  }
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p).replaceAll('\\', '/');
  return `file:///${resolved.replace(/^\/+/, '')}`;
}
