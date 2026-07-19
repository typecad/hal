import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateComponentDeclsForProject } from '../../../packages/cuttlefish/src/libdef/cpp-to-decl';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-comp-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateComponentDeclsForProject', () => {
  it('uses the C emitter for headers without classes', () => {
    const managed = path.join(tmpDir, 'managed_components', 'foo', 'include');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, 'foo.h'), 'void foo_init(void);\n', 'utf8');

    const created = generateComponentDeclsForProject(tmpDir, { managed: ['foo'], local: [] });
    expect(created.length).toBe(1);
    const content = fs.readFileSync(created[0], 'utf8');
    expect(content).toContain('export declare const foo: {');
    expect(content).toContain('init(): void;');
  });

  it('uses the C++ emitter for headers with classes', () => {
    const managed = path.join(tmpDir, 'managed_components', 'cpp_lib', 'include');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(
      path.join(managed, 'lib.h'),
      'class Widget { public: void go(); };',
      'utf8',
    );

    const created = generateComponentDeclsForProject(tmpDir, { managed: ['cpp_lib'], local: [] });
    expect(created.length).toBe(1);
    const content = fs.readFileSync(created[0], 'utf8');
    expect(content).toContain('export declare class Widget');
  });

  it('skips headers that produce no declarations', () => {
    const managed = path.join(tmpDir, 'managed_components', 'empty', 'include');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, 'empty.h'), '// just a comment\n', 'utf8');

    const created = generateComponentDeclsForProject(tmpDir, { managed: ['empty'], local: [] });
    expect(created).toEqual([]);
  });
});
