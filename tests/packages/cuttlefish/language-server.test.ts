import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeForEditor } from '../../../packages/cuttlefish/src/language-server';

// The editor surface sits on analyzeProject (query.ts); these tests pin the
// contract the TypeCAD Intel VS Code extension dynamic-imports from the
// PROJECT's engine copy: config-rooted entry resolution, cross-file
// diagnostics, and actionable errors for unconfigured workspaces.
//
// The helper carries a near-miss baud (9630 ≈ 9600) so the unit-suspicion
// validation fires in a NON-entry file — proving diagnostics aggregate
// across the import graph with each one naming its file.

const MAIN_TS = [
  "import { Time, USB0 } from '@typecad/hal';",
  "import { link } from './helper';",
  '',
  'export async function pollLink() {',
  "  USB0.writeLine('tick');",
  '}',
  '',
  'link(1);',
  'Time.sleep(1000);',
  '',
  'let packet: Owned<Uint8Array> = new Uint8Array(8);',
  'let archived = packet;',
  'UART0.writeLine(String(archived.length));',
  '',
].join('\n');

const HELPER_TS = [
  'const modem = { begin: (baud: number) => baud };',
  '',
  'export function link(channels: number): number {',
  '  modem.begin(9630);',
  '  return channels;',
  '}',
  '',
].join('\n');

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-lsp-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'helper.ts'), HELPER_TS, 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), MAIN_TS, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'typecad-hal.config.ts'),
    [
      "import type { TypecadConfig } from '@typecad/cuttlefish/api';",
      'const config: TypecadConfig = {',
      "  entry: './src/main.ts',",
      '};',
      'export default config;',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('analyzeForEditor (editor-facing no-emit analysis)', () => {
  it('resolves the entry from the workspace config and analyzes read-only', async () => {
    const before = fs.readdirSync(path.join(dir, 'src')).sort();
    const result = await analyzeForEditor({ workspaceRoot: dir });
    const after = fs.readdirSync(path.join(dir, 'src')).sort();

    expect(result.entryFile).toBe(path.join(dir, 'src', 'main.ts'));
    expect(result.files.some((f) => f.endsWith('helper.ts'))).toBe(true);
    expect(after).toEqual(before); // read-only: no output artifacts
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('aggregates diagnostics from non-entry files, each naming its file', async () => {
    const { diagnostics } = await analyzeForEditor({ workspaceRoot: dir });
    const helperDiags = diagnostics.filter(
      (d) => d.filePath === path.join(dir, 'src', 'helper.ts'),
    );
    expect(helperDiags.length).toBeGreaterThan(0);
    expect(helperDiags.some((d) => d.code === 'unit-suspicion' && /9630/.test(d.message))).toBe(true);
    // 1-based positions (the same base the CLI prints) so the extension maps
    // them onto editor ranges with a plain -1.
    const positioned = helperDiags.find((d) => d.line !== undefined);
    if (positioned) expect(positioned.line).toBeGreaterThan(0);
  });

  it('returns headline numbers and pin usage for status display', async () => {
    const { summary, pinUsage } = await analyzeForEditor({ workspaceRoot: dir });
    expect(summary.usesTimers).toBe(true); // Time.sleep in the fixture
    expect(summary.asyncTasks).toBe(1);    // pollLink
    expect(summary.isrHandlers).toBe(0);
    expect(summary.staticBytes).toBeGreaterThanOrEqual(0);
    expect(summary.stackDepth).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(pinUsage)).toBe(true);
  });

  it('carries executable quick-fix payloads on ownership diagnostics', async () => {
    const { diagnostics } = await analyzeForEditor({ workspaceRoot: dir });
    // The fixture's `let archived = packet` (line 12): borrow-by-reference.
    const owned = diagnostics.find((d) => d.code === 'ownership-owned-copy');
    expect(owned?.fix?.title).toContain('Shared');
    expect(owned?.fix?.edits).toEqual([
      { line: 12, column: 1, fromText: 'let', toText: 'const' },
      { line: 12, column: 5, fromText: 'archived ', toText: 'archived: Shared ' },
    ]);
    // And the never-reassigned `let archived` (same line): const promotion.
    // (`packet` itself is skipped by design — typed-array buffers lower with
    // a pointer cppType and are never promoted.)
    const promote = diagnostics.find(
      (d) => d.code === 'ownership-suggest-const' && /'archived'/.test(d.message),
    );
    expect(promote?.fix?.edits).toEqual([
      { line: 12, column: 1, fromText: 'let', toText: 'const' },
    ]);
  });

  it('throws an actionable error for a workspace without config or entry', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'typecad-lsp-empty-'));
    try {
      await expect(analyzeForEditor({ workspaceRoot: empty })).rejects.toThrow(/No entry file/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('throws when the configured entry does not exist', async () => {
    const configPath = path.join(dir, 'typecad-hal.config.ts');
    const original = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(configPath, "export default { entry: './src/gone.ts' };\n", 'utf8');
    try {
      await expect(analyzeForEditor({ workspaceRoot: dir })).rejects.toThrow(/Entry file not found/);
    } finally {
      fs.writeFileSync(configPath, original, 'utf8');
    }
  });
});
