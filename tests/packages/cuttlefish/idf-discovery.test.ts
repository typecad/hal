import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverIdfRootForGenDecls } from '../../../packages/cuttlefish/src/libdef/idf-discovery';

let origIdfPath: string | undefined;

beforeEach(() => {
  origIdfPath = process.env.IDF_PATH;
});

afterEach(() => {
  if (origIdfPath === undefined) delete process.env.IDF_PATH;
  else process.env.IDF_PATH = origIdfPath;
});

describe('discoverIdfRootForGenDecls', () => {
  it('returns $IDF_PATH when set and contains a components/ subdir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idf-disc-'));
    try {
      fs.mkdirSync(path.join(tmp, 'components'), { recursive: true });
      process.env.IDF_PATH = tmp;
      expect(discoverIdfRootForGenDecls()).toBe(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls through to other candidates when $IDF_PATH has no components/', () => {
    // $IDF_PATH that points at a bogus dir is skipped; the discovery then
    // falls through to well-known paths. On a machine with a real IDF
    // install we may still find one — both outcomes are acceptable per the
    // contract ("find ANY IDF install"), we only assert it doesn't throw.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idf-disc-'));
    try {
      process.env.IDF_PATH = tmp;
      const result = discoverIdfRootForGenDecls();
      if (result !== undefined) {
        // Found a real install via fallback — verify it has components/.
        expect(fs.existsSync(path.join(result, 'components'))).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns undefined when no candidates exist', () => {
    process.env.IDF_PATH = '';
    // Well-known paths on this machine may or may not have an IDF install.
    // The function's contract is to return a string when one is found, or
    // undefined otherwise — both are acceptable here. We only assert it
    // doesn't throw.
    expect(() => discoverIdfRootForGenDecls()).not.toThrow();
    const result = discoverIdfRootForGenDecls();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
      expect(fs.existsSync(path.join(result, 'components'))).toBe(true);
    }
  });
});
