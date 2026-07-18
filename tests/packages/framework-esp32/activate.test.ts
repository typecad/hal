import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWrapperContent, ensureIdfActivated, idfSpawn, wrapperPathFor, WRAPPER_NAME,
} from '../../../packages/framework-esp32/src/toolchain/activate';
import { discoverIdfRoot, type IdfRoot } from '../../../packages/framework-esp32/src/toolchain/discover';

const IS_WIN = process.platform === 'win32';

function fakeRoot(path: string, version: string = '6.0.2'): IdfRoot {
  return { path, version, source: 'version-scan' };
}

let tmpDir: string;
const ORIG_IDF_PATH = process.env.IDF_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tc-activate-'));
  // Make sure IDF_PATH is unset so detectIdfEnv reports "not available",
  // forcing the activation path. (detectIdfEnv also checks idf.py on PATH,
  // which we can't easily clear, but on most CI/dev machines idf.py isn't on
  // PATH unless explicitly sourced.)
  delete process.env.IDF_PATH;
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (ORIG_IDF_PATH === undefined) delete process.env.IDF_PATH;
  else process.env.IDF_PATH = ORIG_IDF_PATH;
});

// ── buildWrapperContent ──────────────────────────────────────────────────────

describe('buildWrapperContent', () => {
  const root = fakeRoot(IS_WIN ? 'C:\\esp\\v6.0.2\\esp-idf' : '/opt/esp/v6.0.2/esp-idf');

  it('includes a root marker comment in the platform-correct syntax', () => {
    const content = buildWrapperContent(root);
    if (IS_WIN) {
      expect(content).toContain('REM cuttlefish-idf-root:');
    } else {
      expect(content).toContain('# cuttlefish-idf-root:');
    }
    expect(content).toContain(root.path);
  });

  it('sources the platform-appropriate export script', () => {
    const content = buildWrapperContent(root);
    if (IS_WIN) {
      expect(content).toMatch(/call ".*\\export\.bat"/);
      expect(content).toContain('idf.py %*');
      expect(content).toMatch(/^@echo off/);
    } else {
      expect(content).toMatch(/source ".*\/export\.sh"/);
      expect(content).toContain('exec idf.py "$@"');
      expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
    }
  });

  it('uses CRLF line endings on Windows, LF on POSIX', () => {
    const content = buildWrapperContent(root);
    if (IS_WIN) {
      expect(content).toContain('\r\n');
    } else {
      expect(content).not.toContain('\r\n');
    }
  });
});

// ── wrapperPathFor ───────────────────────────────────────────────────────────

describe('wrapperPathFor', () => {
  it('returns the wrapper path inside the project dir', () => {
    const p = wrapperPathFor('/proj');
    expect(p).toBe(IS_WIN ? '\\proj\\' + WRAPPER_NAME : '/proj/' + WRAPPER_NAME);
  });
});

// ── ensureIdfActivated (via idfSpawn to exercise wrapper generation) ────────

describe('idfSpawn wrapper generation', () => {
  it('generates a wrapper when env is not sourced but discovery finds a root', () => {
    // Create a fake IDF root and point discovery at it by setting IDF_PATH — but
    // we want detectIdfEnv to report "not available" while discoverIdfRoot finds it.
    // Trick: set IDF_PATH to the fake root (so discoverFromEnv hits) but ensure
    // idf.py is NOT on PATH (so detectIdfEnv's idf.py check fails).
    // Make a fake root at <tmpDir>/fake-esp-idf with tools/idf.py + export scripts.
    const root = join(tmpDir, 'fake-esp-idf');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'idf.py'), '');
    writeFileSync(join(root, 'export.sh'), '');
    writeFileSync(join(root, 'export.bat'), '');
    process.env.IDF_PATH = root;

    const projDir = join(tmpDir, 'proj');
    mkdirSync(projDir);

    const inv = idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });

    // Wrapper should exist on disk.
    const wrapper = wrapperPathFor(projDir);
    expect(existsSync(wrapper)).toBe(true);

    // The invocation should reference the wrapper (not call idf.py directly).
    expect(inv.command).not.toBe('idf.py');
    if (IS_WIN) {
      expect(inv.command).toBe('cmd.exe');
      expect(inv.args[3]).toContain(WRAPPER_NAME);
    } else {
      expect(inv.command).toBe('bash');
      expect(inv.args[1]).toContain(WRAPPER_NAME);
    }

    // The activation result should mention auto-sourcing.
    expect(inv.activation).toBeDefined();
    expect(inv.activation!.activated).toBe(true);
    expect(inv.activation!.message).toMatch(/Auto-sourced ESP-IDF/);

    // Wrapper content should source the discovered root.
    const content = readFileSync(wrapper, 'utf8');
    expect(content).toContain(root);
  });

  it('is idempotent — second call does not rewrite the wrapper', () => {
    const root = join(tmpDir, 'fake-esp-idf');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'idf.py'), '');
    writeFileSync(join(root, 'export.sh'), '');
    writeFileSync(join(root, 'export.bat'), '');
    process.env.IDF_PATH = root;

    const projDir = join(tmpDir, 'proj');
    mkdirSync(projDir);

    idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });
    const wrapper = wrapperPathFor(projDir);
    const firstContent = readFileSync(wrapper, 'utf8');

    // Rewrite with a sentinel and ensure the second idfSpawn doesn't overwrite.
    writeFileSync(wrapper, firstContent + '\n# user edit sentinel\n');

    idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });
    const secondContent = readFileSync(wrapper, 'utf8');
    expect(secondContent).toContain('# user edit sentinel');
  });
});

describe('idfSpawn when no IDF is installed', () => {
  // On machines with a real ESP-IDF install, discovery will find it and this
  // test can't exercise the no-IDF path. Skip on those machines.
  const noIdfInstalled = discoverIdfRoot() === null;
  const itMaybe = noIdfInstalled ? it : it.skip;

  itMaybe('throws with an actionable error when discovery finds nothing', () => {
    const projDir = join(tmpDir, 'proj');
    mkdirSync(projDir);
    expect(() => idfSpawn(projDir, ['build'], { cwd: projDir }))
      .toThrow(/ESP-IDF environment not detected|\$IDF_PATH is not set|idf\.py not found/);
  });
});
