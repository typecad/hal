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
    // C emitter produces free functions named 1-to-1 with the header.
    expect(content).toContain('export declare function foo_init(): void;');
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

describe('generateComponentDeclsForProject — sibling .libdef.json emission', () => {
  it('writes a .libdef.json next to each generated .d.ts with the real header name', () => {
    // Use a lowercase_underscore header name to make the case-preservation
    // visible: the libdef must declare "my_comp.h", not "MyComp.h".
    const managed = path.join(tmpDir, 'managed_components', 'my_comp', 'include');
    fs.mkdirSync(managed, { recursive: true });
    const headerPath = path.join(managed, 'my_comp.h');
    fs.writeFileSync(headerPath, 'void my_comp_init(void);\n', 'utf8');

    generateComponentDeclsForProject(tmpDir, { managed: ['my_comp'], local: [] });

    const libdefPath = path.join(managed, 'my_comp.libdef.json');
    expect(fs.existsSync(libdefPath)).toBe(true);
    const libdef = JSON.parse(fs.readFileSync(libdefPath, 'utf8'));
    expect(libdef.module).toBe('my_comp');
    // CRITICAL: include is the case-preserving real header basename,
    // quote-wrapped (project-local include). NOT <MyComp.h>.
    expect(libdef.include).toBe('"my_comp.h"');
    expect(libdef.include).not.toBe('<MyComp.h>');
    // The source field points at the original header.
    expect(libdef.source).toBe(headerPath);
  });

  it('does not write a .libdef.json when the header produced no declarations', () => {
    const managed = path.join(tmpDir, 'managed_components', 'empty', 'include');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, 'empty.h'), '// just a comment\n', 'utf8');

    generateComponentDeclsForProject(tmpDir, { managed: ['empty'], local: [] });

    expect(fs.existsSync(path.join(managed, 'empty.libdef.json'))).toBe(false);
  });

  it('libdef module field is lowercased to match toModuleKey()', () => {
    // A header like "WiFi.h" would naturally produce a libdef whose module
    // is "wifi" (lowercased) — matching what toModuleKey produces from an
    // import specifier. This is what makes the lookup work.
    const managed = path.join(tmpDir, 'managed_components', 'wifi', 'include');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, 'WiFi.h'), 'void wifi_connect(void);\n', 'utf8');

    generateComponentDeclsForProject(tmpDir, { managed: ['wifi'], local: [] });

    const libdef = JSON.parse(
      fs.readFileSync(path.join(managed, 'WiFi.libdef.json'), 'utf8'),
    );
    expect(libdef.module).toBe('wifi'); // lowercased
    expect(libdef.include).toBe('"WiFi.h"'); // case preserved
  });
});
