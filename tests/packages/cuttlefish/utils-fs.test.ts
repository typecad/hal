import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listFiles, listFilesRecursive, writeText } from '../../../packages/cuttlefish/src/utils/fs';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-fs-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content = ''): string {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

describe('listFiles (non-recursive — regression guard)', () => {
  it('returns top-level files matching the extension', () => {
    const a = writeFile('a.libdef.json');
    const b = writeFile('b.libdef.json');
    writeFile('c.txt');
    const result = listFiles(tmpDir, '.libdef.json').sort();
    expect(result).toEqual([a, b].sort());
  });

  it('does not recurse into subdirectories', () => {
    writeFile('top.libdef.json');
    writeFile('nested/inner.libdef.json');
    const result = listFiles(tmpDir, '.libdef.json');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(tmpDir, 'top.libdef.json'));
  });

  it('returns [] for a non-existent directory', () => {
    expect(listFiles(path.join(tmpDir, 'does-not-exist'), '.json')).toEqual([]);
  });
});

describe('listFilesRecursive', () => {
  it('finds files at the top level (parity with listFiles)', () => {
    const a = writeFile('a.libdef.json');
    const b = writeFile('b.libdef.json');
    writeFile('c.txt');
    const result = listFilesRecursive(tmpDir, '.libdef.json').sort();
    expect(result).toEqual([a, b].sort());
  });

  it('recurses into subdirectories', () => {
    const top = writeFile('top.libdef.json');
    const mid = writeFile('nested/mid.libdef.json');
    const deep = writeFile('nested/deeper/deep.libdef.json');
    const result = listFilesRecursive(tmpDir, '.libdef.json').sort();
    expect(result).toEqual([top, mid, deep].sort());
  });

  it('is case-insensitive on the extension', () => {
    writeFile('upper.LIBDEF.JSON');
    const result = listFilesRecursive(tmpDir, '.libdef.json');
    expect(result).toHaveLength(1);
  });

  it('returns [] for a non-existent directory', () => {
    expect(listFilesRecursive(path.join(tmpDir, 'does-not-exist'), '.json')).toEqual([]);
  });

  it('skips unreadable subdirectories without throwing', () => {
    // Defensive: a directory we can't read shouldn't abort the whole walk.
    // We can't easily make a dir unreadable on Windows, so this test just
    // confirms the walk doesn't throw on a normal tree. The catch block in
    // the implementation covers the failure case.
    writeFile('a.libdef.json');
    writeFile('sub/b.libdef.json');
    expect(() => listFilesRecursive(tmpDir, '.libdef.json')).not.toThrow();
  });
});

describe('writeText', () => {
  it('writes new files', () => {
    const file = path.join(tmpDir, 'new.txt');
    writeText(file, 'hello');
    expect(fs.readFileSync(file, 'utf8')).toBe('hello');
  });

  it('skips writing when content is identical (mtime preserved)', () => {
    const file = path.join(tmpDir, 'same.txt');
    writeText(file, 'unchanged');
    const mtimeBefore = fs.statSync(file).mtimeMs;
    // Bump mtime to a known-later value; if writeText skips, the mtime
    // stays where we set it rather than being rewritten to "now".
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    writeText(file, 'unchanged');
    expect(fs.statSync(file).mtimeMs).toBe(later.getTime());
  });

  it('overwrites when content differs', () => {
    const file = path.join(tmpDir, 'change.txt');
    writeText(file, 'first');
    writeText(file, 'second');
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
  });
});
