// ---------------------------------------------------------------------------
// sync-typecad-ui.mjs — refresh every vendored copy of the typeCAD/hal VS Code
// extension
//
// The bundled VS Code extension (the merge of the former typecad-ui grammar,
// TypeCAD Debug, and TypeCAD Intel extensions) lives in
// packages/vscode-typecad-hal (tracked source) and is staged into
// packages/cuttlefish/assets/editor-extensions/typecad-hal (shipped with the
// npm package), then vendored into workspaces via writeEditorIntegration.
// This script keeps all copies pinned:
//
//   1. compiles packages/vscode-typecad-hal and stages its build +
//      ui-language assets into cuttlefish assets (the runtime pieces only —
//      no devDependencies)
//   2. rebuilds @typecad/cuttlefish so dist matches src
//   3. re-runs writeEditorIntegration on the repo root and every demo with a
//      typecad-hal.config.ts (.vscode/extensions/, extensions.json, tasks.json
//      — pruning the superseded pre-merge extension folders)
//
// Run after changing the extension or the ui-language assets:
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

// 1. Stage the extension build into cuttlefish assets. The source is TRACKED,
//    but it is not an npm workspace — bootstrap its devDependencies on first
//    use so a fresh clone can sync.
const EXT_SRC = path.join(REPO, 'packages/vscode-typecad-hal');
const EXT_DEST = path.join(REPO, 'packages/cuttlefish/assets/editor-extensions/typecad-hal');
if (fs.existsSync(path.join(EXT_SRC, 'package.json'))) {
  if (!fs.existsSync(path.join(EXT_SRC, 'node_modules', 'typescript'))) {
    run('npm install --prefix packages/vscode-typecad-hal');
  }
  run('npm run compile --prefix packages/vscode-typecad-hal');
  fs.rmSync(EXT_DEST, { recursive: true, force: true });
  fs.mkdirSync(EXT_DEST, { recursive: true });
  // The whole compiled out/ (extension.js + modules like board-facts.js) and
  // the declarative ui-language/ assets (grammars, snippets, icons) — the
  // vendored copy must be runnable standalone.
  fs.cpSync(path.join(EXT_SRC, 'out'), path.join(EXT_DEST, 'out'), { recursive: true });
  fs.cpSync(path.join(EXT_SRC, 'ui-language'), path.join(EXT_DEST, 'ui-language'), { recursive: true });
  for (const file of ['package.json', 'README.md']) {
    fs.copyFileSync(path.join(EXT_SRC, file), path.join(EXT_DEST, file));
  }
  console.log(`staged typecad-hal -> ${path.relative(REPO, EXT_DEST)}`);
} else {
  console.log('skip: packages/vscode-typecad-hal not present — keeping staged assets as-is');
}

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
    if (entry.isDirectory() && fs.existsSync(path.join(demosDir, entry.name, 'typecad-hal.config.ts'))) {
      targets.push(path.join(demosDir, entry.name));
    }
  }
}

for (const target of targets) {
  const written = writeEditorIntegration(target);
  console.log(`${path.relative(REPO, target) || '.'} -> ${written.length} editor files refreshed`);

  // Debug artifacts (launch.json/tasks.json/openocd.cfg) — hand-assembled demos
  // never went through typecad-hal create's finalize step, so regenerate them
  // from each demo's config. No-ops for frameworks/targets without GDB support.
  const demo = path.relative(REPO, target);
  if (demo) {
    const cfg = fs.readFileSync(path.join(target, 'typecad-hal.config.ts'), 'utf-8');
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
