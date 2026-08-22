// Tests for cuttlefish create's editor-integration scaffolding
// (src/create/editor-integration.ts): the bundled VS Code extensions copied
// into <project>/.vscode/extensions/ (typecad-ui highlighting + typecad-debug
// breakpoints), the companion .vscode/extensions.json forceInstall entries,
// the .vscode/tasks.json watch task with problem matchers, and scaffoldProject
// wiring all of it (plus .editorconfig) into its created-files report.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateExtensionsJson,
  generateTasksJson,
  watchBuildTask,
  writeEditorIntegration,
  bundledExtensionSourceDir,
  TYPECAD_UI_EXTENSION_ID,
  TYPECAD_DEBUG_EXTENSION_ID,
  WATCH_TASK_LABEL,
} from "../../../packages/cuttlefish/src/create/editor-integration";
import { scaffoldProject } from "../../../packages/cuttlefish/src/create/scaffold";
import type { CreateProjectOptions } from "../../../packages/cuttlefish/src/create/templates";

const OPTIONS: CreateProjectOptions = {
  projectName: 'test-project',
  targetId: 'arduino-uno',
  boardId: 'arduino-uno',
  boardDisplayName: 'Arduino Uno',
  architecture: 'avr',
  boardPackage: '@typecad/board-arduino-uno',
  frameworkPackage: '@typecad/framework-arduino',
  framework: 'arduino',
  buildTarget: 'arduino:avr:uno',
  mcu: 'atmega328p',
  baudRate: 9600,
  includeSketch: true,
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-editor-integration-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("shipped typecad-ui extension assets", () => {
  it("exist in the package and form a valid grammar-only extension", () => {
    const srcDir = bundledExtensionSourceDir('typecad-ui');
    expect(fs.existsSync(path.join(srcDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, 'language-configuration.json'))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, 'LICENSE'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    // Grammar-only: static contributions, no runtime code to activate.
    expect(manifest.main).toBeUndefined();
    expect(manifest.contributes.languages).toHaveLength(1);
    expect(manifest.contributes.languages[0].id).toBe('typecad-ui');
    expect(manifest.contributes.languages[0].extensions).toContain('.ui');
    // Workspace extensions need VS Code >= 1.89.
    expect(manifest.engines.vscode).toBe('^1.89.0');

    const grammarPath = path.join(srcDir, manifest.contributes.grammars[0].path);
    const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf-8'));
    expect(grammar.scopeName).toBe(manifest.contributes.grammars[0].scopeName);
    expect(grammar.scopeName).toBe('source.typecad-ui');
    // Fully de-Svelted: stale scope references would silently disable rules.
    expect(JSON.stringify(grammar)).not.toContain('svelte');
  });

  it("ships snippets for the .ui idioms", () => {
    const srcDir = bundledExtensionSourceDir('typecad-ui');
    const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    expect(manifest.contributes.snippets).toHaveLength(1);

    const snippets = JSON.parse(
      fs.readFileSync(path.join(srcDir, manifest.contributes.snippets[0].path), 'utf-8'),
    );
    const prefixes = Object.values(snippets).map(s => s.prefix);
    for (const prefix of ['screen', 'button', 'bind', 'signal', 'canvas', 'list']) {
      expect(prefixes).toContain(prefix);
    }
  });

  it("injects .ui highlighting into markdown fences", () => {
    const srcDir = bundledExtensionSourceDir('typecad-ui');
    const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    const md = manifest.contributes.grammars.find(g => g.scopeName === 'markdown.typecad-ui.codeblock');
    expect(md).toBeDefined();
    expect(md.injectTo).toEqual(['text.html.markdown']);

    const grammar = JSON.parse(fs.readFileSync(path.join(srcDir, md.path), 'utf-8'));
    expect(JSON.stringify(grammar)).toContain('source.typecad-ui');
    // The fence matches ```ui (and the long alias) but stays a pure injection.
    expect(grammar.injectionSelector).toBe('L:text.html.markdown');
  });

  it("polishes word selection and indentation in the language configuration", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(bundledExtensionSourceDir('typecad-ui'), 'language-configuration.json'), 'utf-8'),
    );
    // {expr} and on:click style tokens select as one word.
    expect(config.wordPattern).toContain('{[^}]*}');
    expect(new RegExp(config.wordPattern).test('on:click')).toBe(true);
    // Enter after an opening tag or { indents; } ) </ unindent.
    expect(config.indentationRules.increaseIndentPattern).toBeDefined();
    expect(config.indentationRules.decreaseIndentPattern).toBeDefined();
    expect(new RegExp(config.indentationRules.increaseIndentPattern).test('<screen id="home">')).toBe(true);
    expect(new RegExp(config.indentationRules.decreaseIndentPattern).test('  </screen>')).toBe(true);
  });

  it("ships a built typecad-debug extension with runtime code", () => {
    const srcDir = bundledExtensionSourceDir('typecad-debug');
    const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    expect(manifest.name).toBe('vscode-typecad-debug');
    expect(manifest.publisher).toBe('typecad');
    expect(manifest.main).toMatch(/out\/extension\.js$/);
    expect(manifest.contributes.commands.length).toBeGreaterThan(0);
    // The compiled runtime is staged (out/ is gitignored in its source repo,
    // so the staged copy is what ships).
    expect(fs.existsSync(path.join(srcDir, manifest.main))).toBe(true);
  });

  it("has square PNG icons for the extension and explorer file list", () => {
    const srcDir = bundledExtensionSourceDir('typecad-ui');
    const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));

    expect(manifest.icon).toBe('icon.png');
    const icon = fs.readFileSync(path.join(srcDir, manifest.icon));
    expect(icon.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(icon.readUInt32BE(16)).toBe(icon.readUInt32BE(20));
    expect(icon.readUInt32BE(16)).toBeGreaterThanOrEqual(128);

    const langIcon = manifest.contributes.languages[0].icon;
    expect(path.basename(langIcon.light)).toBe('file-icon-light.png');
    expect(path.basename(langIcon.dark)).toBe('file-icon-dark.png');
    for (const variant of [langIcon.light, langIcon.dark]) {
      const png = fs.readFileSync(path.join(srcDir, variant));
      expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
    }
  });
});

describe("generateExtensionsJson", () => {
  it("force-installs both bundled workspace extensions", () => {
    const parsed = JSON.parse(generateExtensionsJson());
    expect(parsed.forceInstall).toEqual([TYPECAD_UI_EXTENSION_ID, TYPECAD_DEBUG_EXTENSION_ID]);
    // VS Code expects publisher.name identifiers.
    expect(TYPECAD_UI_EXTENSION_ID).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
    expect(TYPECAD_DEBUG_EXTENSION_ID).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
  });
});

describe("generateTasksJson", () => {
  it("writes a background watch task with color-free problem matchers", () => {
    const doc = JSON.parse(generateTasksJson());
    expect(doc.version).toBe('2.0.0');
    expect(doc.tasks).toHaveLength(1);

    const task = doc.tasks[0];
    expect(task.label).toBe(WATCH_TASK_LABEL);
    expect(task.command).toBe('npm run dev');
    expect(task.isBackground).toBe(true);
    // NO_COLOR keeps chalk out of the diagnostic lines the matchers parse.
    expect(task.options.env.NO_COLOR).toBe('1');

    expect(task.problemMatcher).toHaveLength(2);
    const transpiler = task.problemMatcher.find(m => m.owner === 'cuttlefish-transpiler');
    const eslint = task.problemMatcher.find(m => m.owner === 'cuttlefish-eslint');
    expect(transpiler.pattern.regexp).toContain('(error|warning)');
    expect(eslint.pattern.regexp).toContain('error');
    for (const matcher of task.problemMatcher) {
      // Background watchers sync with the watch loop's pass boundaries.
      expect(matcher.background.beginsPattern).toBe('Transpiling');
      expect(matcher.background.endsPattern).toBe('Watching for changes');
    }
  });

  it("matches both diagnostic line formats", () => {
    const task = watchBuildTask();
    const transpiler = new RegExp(task.problemMatcher[0].pattern.regexp);
    const eslint = new RegExp(task.problemMatcher[1].pattern.regexp);
    const m1 = 'src/main.ts error [UI001] (12,5): unsupported syntax'.match(transpiler);
    expect(m1?.[1]).toBe('src/main.ts');
    expect(m1?.[2]).toBe('error');
    expect(m1?.[3]).toBe('12');
    expect(m1?.[4]).toBe('5');
    const m2 = 'error src/main.ui(3,9) [no-dom-apis]: document is not available'.match(eslint);
    expect(m2?.[1]).toBe('src/main.ui');
    expect(m2?.[2]).toBe('3');
    expect(m2?.[3]).toBe('9');
  });

  it("merges by label, preserving other tasks", () => {
    const existing = [{ label: 'zephyr: build+flash', command: 'west build' }];
    const doc = JSON.parse(generateTasksJson(existing));
    expect(doc.tasks).toHaveLength(2);
    expect(doc.tasks.map(t => t.label)).toEqual(['zephyr: build+flash', WATCH_TASK_LABEL]);

    const withStaleWatch = [...existing, { label: WATCH_TASK_LABEL, command: 'stale' }];
    const doc2 = JSON.parse(generateTasksJson(withStaleWatch));
    expect(doc2.tasks).toHaveLength(2);
    expect(doc2.tasks.find(t => t.label === WATCH_TASK_LABEL).command).toBe('npm run dev');
  });
});

describe("writeEditorIntegration", () => {
  function seedDevScript() {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: { dev: 'cuttlefish build --watch' } }),
      'utf-8',
    );
  }

  it("copies both extensions and writes extensions.json + tasks.json", () => {
    seedDevScript();
    const written = writeEditorIntegration(tmpDir);
    const rel = written.map(p => p.replace(/\\/g, '/'));

    expect(rel.some(p => p.endsWith('.vscode/extensions/typecad-ui/package.json'))).toBe(true);
    expect(rel.some(p => p.endsWith('.vscode/extensions/typecad-debug/package.json'))).toBe(true);
    expect(rel.some(p => p.endsWith('.vscode/extensions/typecad-debug/out/extension.js'))).toBe(true);
    expect(rel.some(p => p.endsWith('.vscode/extensions.json'))).toBe(true);
    expect(rel.some(p => p.endsWith('.vscode/tasks.json'))).toBe(true);

    const extensionsJson = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'extensions.json'), 'utf-8'),
    );
    expect(extensionsJson.forceInstall).toEqual([TYPECAD_UI_EXTENSION_ID, TYPECAD_DEBUG_EXTENSION_ID]);

    const tasks = JSON.parse(fs.readFileSync(path.join(tmpDir, '.vscode', 'tasks.json'), 'utf-8'));
    expect(tasks.tasks[0].label).toBe(WATCH_TASK_LABEL);
  });

  it("skips the watch task when the project has no dev script", () => {
    // No package.json at all (e.g. the monorepo root) — extensions still
    // install, but a task running `npm run dev` would just error.
    const written = writeEditorIntegration(tmpDir);
    expect(written.length).toBeGreaterThan(0);
    expect(written.map(p => p.replace(/\\/g, '/')).some(p => p.endsWith('.vscode/tasks.json'))).toBe(false);
  });

  it("warns and skips when the extension assets are missing", () => {
    const emptyAssetsRoot = path.join(tmpDir, 'no-such-assets');
    const written = writeEditorIntegration(tmpDir, emptyAssetsRoot);
    expect(written).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.vscode'))).toBe(false);
  });
});

describe("scaffoldProject wiring", () => {
  it("scaffolds the editor integration and editorconfig, reporting them in createdFiles", () => {
    const result = scaffoldProject(OPTIONS, tmpDir);

    const created = result.createdFiles.map(p => p.replace(/\\/g, '/'));
    expect(created.some(p => p.endsWith('.editorconfig'))).toBe(true);
    expect(created.some(p => p.endsWith('.vscode/extensions.json'))).toBe(true);
    expect(created.some(p => p.endsWith('.vscode/tasks.json'))).toBe(true);
    expect(created.some(p => p.endsWith('.vscode/extensions/typecad-ui/package.json'))).toBe(true);
    expect(created.some(p => p.endsWith('.vscode/extensions/typecad-ui/syntaxes/typecad-ui.tmLanguage.json'))).toBe(true);
    expect(created.some(p => p.endsWith('.vscode/extensions/typecad-debug/package.json'))).toBe(true);

    expect(fs.existsSync(path.join(tmpDir, '.vscode', 'extensions', 'typecad-debug', 'out', 'extension.js'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, '.editorconfig'), 'utf-8')).toContain('root = true');
    expect(JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'extensions.json'), 'utf-8'),
    ).forceInstall).toContain(TYPECAD_UI_EXTENSION_ID);
  });
});
