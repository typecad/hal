import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  depsHashChanged,
  writeDepsHash,
  hashForComponents,
} from '../../../packages/framework-esp32/src/components/deps-hash';
import type { ScaffoldComponents } from '../../../packages/framework-esp32/src/components/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-hash-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('hashForComponents', () => {
  it('is stable for the same input', () => {
    const c: ScaffoldComponents = { managed: { 'a/b': '^1.0' }, local: ['/x'] };
    expect(hashForComponents(c)).toBe(hashForComponents(c));
  });

  it('changes when managed changes', () => {
    const a: ScaffoldComponents = { managed: { 'a/b': '^1.0' }, local: [] };
    const b: ScaffoldComponents = { managed: { 'a/b': '^2.0' }, local: [] };
    expect(hashForComponents(a)).not.toBe(hashForComponents(b));
  });

  it('changes when local changes', () => {
    const a: ScaffoldComponents = { managed: {}, local: ['/x'] };
    const b: ScaffoldComponents = { managed: {}, local: ['/y'] };
    expect(hashForComponents(a)).not.toBe(hashForComponents(b));
  });

  it('is order-insensitive for managed (sorted before hashing)', () => {
    const a: ScaffoldComponents = { managed: { 'a/b': '^1.0', 'c/d': '^2.0' }, local: [] };
    const b: ScaffoldComponents = { managed: { 'c/d': '^2.0', 'a/b': '^1.0' }, local: [] };
    expect(hashForComponents(a)).toBe(hashForComponents(b));
  });
});

describe('depsHashChanged / writeDepsHash', () => {
  it('returns true when no hash file exists', () => {
    const c: ScaffoldComponents = { managed: { 'a/b': '^1.0' }, local: [] };
    expect(depsHashChanged(tmpDir, c)).toBe(true);
  });

  it('returns false after writing the hash, with the same components', () => {
    const c: ScaffoldComponents = { managed: { 'a/b': '^1.0' }, local: [] };
    writeDepsHash(tmpDir, c);
    expect(depsHashChanged(tmpDir, c)).toBe(false);
  });

  it('returns true after the hash is written, then components change', () => {
    const c1: ScaffoldComponents = { managed: { 'a/b': '^1.0' }, local: [] };
    const c2: ScaffoldComponents = { managed: { 'a/b': '^2.0' }, local: [] };
    writeDepsHash(tmpDir, c1);
    expect(depsHashChanged(tmpDir, c2)).toBe(true);
  });
});
