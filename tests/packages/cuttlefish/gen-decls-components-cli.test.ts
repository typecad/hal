import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseCommandLine } from '@typecad/cuttlefish/testing';

describe('gen-decls --components', () => {
  it('sets componentsDir to cwd when no path given', () => {
    const r: any = parseCommandLine(['node', 'cuttlefish', 'gen-decls', '--components']);
    expect(r.command).toBe('gen-decls');
    expect(r.componentsDir).toBe(process.cwd());
    expect(r.scanDir).toBeUndefined();
    expect(r.inputFile).toBeUndefined();
  });

  it('sets componentsDir to the given path', () => {
    const r: any = parseCommandLine([
      'node', 'cuttlefish', 'gen-decls', '--components', './proj',
    ]);
    expect(r.command).toBe('gen-decls');
    expect(r.componentsDir).toBe(path.resolve(process.cwd(), './proj'));
  });

  it('rejects combining --components with --all', () => {
    expect(() =>
      parseCommandLine(['node', 'cuttlefish', 'gen-decls', '--components', '--all']),
    ).toThrow(/--components.*--all/);
  });
});
