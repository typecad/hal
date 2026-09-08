// ---------------------------------------------------------------------------
// editor-integration.ts — create-time editor scaffolding for .ui highlighting
//
// Cuttlefish projects keep their UI in .ui single-file components (TS script +
// CSS style + Svelte-style markup), which no editor knows out of the box. The
// package ships grammar-only VS Code extensions under
// assets/editor-extensions/ and `typecad-hal create` copies them into the new
// project's .vscode/extensions/ folder:
//
//   typecad-ui     — .ui syntax highlighting, snippets, file icons, markdown
//                    ```ui fence highlighting (grammar-only, no code).
//   typecad-debug  — the built TypeCAD Debug extension (breakpoint syncing +
//                    F5 commands), so debugging works with zero install.
//
// VS Code (1.89+, trusted workspaces) detects workspace-bundled extensions and
// installs them scoped to that workspace. The companion .vscode/extensions.json
// carries forceInstall entries (microsoft/vscode#299830) so VS Code builds with
// that feature skip the approval prompt; older builds show a one-time install
// prompt instead.
//
// A .vscode/tasks.json watch task is also written: it runs the project's
// `typecad-hal build --watch` dev script with NO_COLOR=1 and parses the
// transpiler/ESLint diagnostic lines into Problems-panel squiggles. The task
// merges by label (never clobbers user edits or the framework debug writer's
// tasks, which merge the same way).
//
// Everything here is best-effort like the debug-artifact generation: a missing
// or unreadable asset tree warns and skips rather than failing `cuttlefish
// create`, because a project without editor integration still builds fine.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** VS Code extension identifiers (publisher.name) of the bundled extensions. */
export const TYPECAD_UI_EXTENSION_ID = 'typecad.typecad-ui';
export const TYPECAD_DEBUG_EXTENSION_ID = 'typecad.vscode-typecad-debug';

/** Extensions to bundle, as { asset folder name → extension id } pairs. */
const BUNDLED_EXTENSIONS: ReadonlyArray<{ dir: string; id: string }> = [
  { dir: 'typecad-ui', id: TYPECAD_UI_EXTENSION_ID },
  { dir: 'typecad-debug', id: TYPECAD_DEBUG_EXTENSION_ID },
];

const ASSETS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..',
  'assets', 'editor-extensions',
);

/**
 * Source location of an unpacked bundled extension inside the cuttlefish
 * package. Resolved from this module's location so it works from both src/
 * (dev and tests importing source) and dist/ (the published CLI) — assets/
 * sits at the package root either way.
 */
export function bundledExtensionSourceDir(dir: string): string {
  return path.join(ASSETS_ROOT, dir);
}

/** Kept for compatibility with the original single-extension helper. */
export function typecadUiExtensionSourceDir(): string {
  return bundledExtensionSourceDir('typecad-ui');
}

/** Content of .vscode/extensions.json — auto-installs the workspace-bundled extensions. */
export function generateExtensionsJson(): string {
  return `${JSON.stringify(
    { forceInstall: BUNDLED_EXTENSIONS.map(e => e.id) },
    null,
    2,
  )}\n`;
}

// -- watch task + problem matchers ------------------------------------------------

/**
 * Problem matchers for cuttlefish's two diagnostic line formats:
 *   transpiler:  "<file> error|warning [code] (line,column): message"
 *   eslint gate: "error <file>(line,column) [rule]: message"
 * NO_COLOR=1 is set on the task so chalk stays off and the lines stay greppable.
 */
const PROBLEM_MATCHERS = [
  {
    owner: 'typecad-hal-transpiler',
    severity: 'error',
    fileLocation: ['relative', '${workspaceFolder}'],
    pattern: {
      regexp: '^\\s*(.*?)\\s+(error|warning)(?:\\s+\\[[^\\]]*\\])?\\s*\\((\\d+),(\\d+)\\):\\s+(.*)$',
      file: 1,
      severity: 2,
      line: 3,
      column: 4,
      message: 5,
    },
    background: {
      beginsPattern: 'Transpiling',
      endsPattern: 'Watching for changes',
    },
  },
  {
    owner: 'typecad-hal-eslint',
    severity: 'error',
    fileLocation: ['relative', '${workspaceFolder}'],
    pattern: {
      regexp: '^\\s*error\\s+(.*?)\\((\\d+),(\\d+)\\)\\s+\\[[^\\]]*\\]:\\s+(.*)$',
      file: 1,
      line: 2,
      column: 3,
      message: 4,
    },
    background: {
      beginsPattern: 'Transpiling',
      endsPattern: 'Watching for changes',
    },
  },
];

export const WATCH_TASK_LABEL = 'typecad-hal: watch build';

/** The watch task entry written to .vscode/tasks.json. */
export function watchBuildTask(): Record<string, unknown> {
  return {
    label: WATCH_TASK_LABEL,
    command: 'npm run dev',
    type: 'shell',
    isBackground: true,
    group: 'build',
    options: { env: { NO_COLOR: '1' } },
    problemMatcher: PROBLEM_MATCHERS,
  };
}

/**
 * Content of .vscode/tasks.json containing the watch task. Kept separate from
 * the merge logic so tests can assert the shape without a filesystem.
 */
export function generateTasksJson(existingTasks: ReadonlyArray<Record<string, unknown>> = []): string {
  const tasks = [...existingTasks];
  const idx = tasks.findIndex(t => t.label === WATCH_TASK_LABEL);
  const task = watchBuildTask();
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  return `${JSON.stringify({ version: '2.0.0', tasks }, null, 2)}\n`;
}

/**
 * Read-merge-write .vscode/tasks.json with the watch task (by label), so user
 * edits and the framework debug writer's tasks survive. Mirrors the Zephyr
 * debug-config merge semantics.
 */
function writeTasksJson(vscodeDir: string): string {
  const tasksPath = path.join(vscodeDir, 'tasks.json');
  let existing: Record<string, unknown>[] = [];
  if (fs.existsSync(tasksPath)) {
    try {
      const doc: unknown = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
      const tasks = (doc as { tasks?: unknown }).tasks;
      if (Array.isArray(tasks)) {
        existing = tasks.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object');
      }
    } catch {
      // malformed — start fresh
    }
  }
  fs.writeFileSync(tasksPath, generateTasksJson(existing), 'utf-8');
  return tasksPath;
}

// -- install -----------------------------------------------------------------

/** All files under `dir`, as paths relative to `dir`. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of listFilesRecursive(path.join(dir, entry.name))) {
        out.push(path.join(entry.name, nested));
      }
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Whether <outDir> has an `npm run dev` script for the watch task to drive.
 * The task is skipped when it doesn't (e.g. the monorepo root or hand-made
 * projects), because a task referencing a missing script just errors on run.
 */
function hasDevScript(outDir: string): boolean {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(outDir, 'package.json'), 'utf-8'));
    const scripts = (pkg as { scripts?: Record<string, unknown> }).scripts;
    return typeof scripts?.dev === 'string';
  } catch {
    return false;
  }
}

/**
 * Folder pattern matching the workspace-bundled extension copies. These carry
 * their own package.json manifests, which VS Code otherwise picks up as a
 * second npm package in the project.
 */
const BUNDLED_EXTENSION_GLOB = '**/.vscode/extensions/**';

/**
 * Settings that keep the NPM Scripts pane working on the PROJECT's scripts
 * (build/upload/… — the project's primary commands) while hiding the
 * workspace-bundled editor extensions' manifests: their package.json files
 * are excluded from npm detection individually (so no second package shows
 * up) and the extensions folder is hidden from the Explorer and search — it
 * is internal scaffolding, not user code. `npm.autoDetect` is set to 'on'
 * EXPLICITLY: an earlier scaffold wrote 'off', which blanks the NPM Scripts
 * pane ("the setting npm.autoDetect is off") — and the explicit value also
 * heals settings.json files written by that older scaffold.
 */
const END_USER_NPM_SETTINGS: Record<string, unknown> = {
  'npm.autoDetect': 'on',
  'npm.exclude': `${BUNDLED_EXTENSION_GLOB}/package.json`,
  'debug.javascript.codelens.npmScripts': 'never',
  'files.exclude': { '.vscode/extensions': true },
  'search.exclude': { '**/.vscode/extensions': true },
};

/**
 * Read-merge-write .vscode/settings.json with the npm-hiding settings. Merge-
 * safe because the framework debug writer may also contribute settings
 * (e.g. cortex-debug paths) — those must survive.
 */
function writeNpmHiddenSettings(vscodeDir: string): string {
  const settingsPath = path.join(vscodeDir, 'settings.json');
  let doc: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      }
    } catch {
      // malformed — start fresh
    }
  }
  for (const [key, value] of Object.entries(END_USER_NPM_SETTINGS)) {
    const existingValue = doc[key];
    // nested objects (files.exclude, search.exclude) merge key-by-key so user
    // entries in the same map survive; scalars and arrays are overwritten.
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
    ) {
      doc[key] = { ...(existingValue as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      doc[key] = value;
    }
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return settingsPath;
}

/**
 * Copy the bundled extensions into <outDir>/.vscode/extensions/, then write the
 * companion .vscode/extensions.json and — when the project has a `dev` watch
 * script — the .vscode/tasks.json watch task. Returns the absolute paths
 * written, or [] when the extension assets are missing (warns, never throws).
 * `assetsRoot` overrides the bundled-asset location (tests). `hideNpm` (used by
 * `typecad-hal create` for end-user projects) also writes settings.json keys
 * that hide VS Code's NPM Scripts view and npm task detection.
 */
export function writeEditorIntegration(outDir: string, assetsRoot?: string, hideNpm = false): string[] {
  const vscodeDir = path.join(outDir, '.vscode');
  const extensionRoot = path.join(vscodeDir, 'extensions');
  const root = assetsRoot ?? ASSETS_ROOT;

  const written: string[] = [];
  let copiedAny = false;
  for (const ext of BUNDLED_EXTENSIONS) {
    const src = path.join(root, ext.dir);
    if (!fs.existsSync(path.join(src, 'package.json'))) {
      console.warn(`! Editor integration: ${ext.dir} extension assets not found at ${src} — skipped`);
      continue;
    }
    const dest = path.join(extensionRoot, ext.dir);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    for (const rel of listFilesRecursive(dest)) written.push(path.join(dest, rel));
    copiedAny = true;
  }
  if (!copiedAny) return [];

  const extensionsJsonPath = path.join(vscodeDir, 'extensions.json');
  fs.writeFileSync(extensionsJsonPath, generateExtensionsJson(), 'utf-8');
  written.push(extensionsJsonPath);

  if (hasDevScript(outDir)) {
    written.push(writeTasksJson(vscodeDir));
  }

  if (hideNpm) {
    written.push(writeNpmHiddenSettings(vscodeDir));
  }

  return written;
}
