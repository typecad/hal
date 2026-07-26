import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWrapperContent, ensureIdfActivated, idfSpawn, wrapperPathFor, WRAPPER_NAME,
  resolveEspToolchains, resolveVersionedBinary,
} from '../../../packages/framework-esp32/src/toolchain/activate';
import { discoverIdfRoot, resetDiscoverIdfRootCache, type IdfRoot } from '../../../packages/framework-esp32/src/toolchain/discover';
import { resetDetectIdfEnvCache } from '../../../packages/framework-esp32/src/toolchain/idf-env';

const IS_WIN = process.platform === 'win32';

function fakeRoot(path: string, version: string = '6.0.2'): IdfRoot {
  return { path, version, source: 'version-scan' };
}

let tmpDir: string;
const ORIG_IDF_PATH = process.env.IDF_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tc-activate-'));
  resetDiscoverIdfRootCache();
  resetDetectIdfEnvCache();
  // Make sure IDF_PATH is unset so detectIdfEnv reports "not available",
  // forcing the activation path. (detectIdfEnv also checks idf.py on PATH,
  // which we can't easily clear, but on most CI/dev machines idf.py isn't on
  // PATH unless explicitly sourced.)
  delete process.env.IDF_PATH;
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetDiscoverIdfRootCache();
  resetDetectIdfEnvCache();
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

describe('idfSpawn with fake IDF root', () => {
  it('produces an invocation with activation info when env is not sourced', () => {
    // Create a fake IDF root and point discovery at it by setting IDF_PATH.
    // detectIdfEnv will report "not available" (idf.py not on PATH), but
    // discoverIdfRoot will find it via IDF_PATH. idfSpawn then either uses
    // the cached env (fast path) or falls back to the wrapper (slow path).
    const root = join(tmpDir, 'fake-esp-idf');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'idf.py'), '');
    writeFileSync(join(root, 'export.sh'), '');
    writeFileSync(join(root, 'export.bat'), '');
    process.env.IDF_PATH = root;

    const projDir = join(tmpDir, 'proj');
    mkdirSync(projDir);

    const inv = idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });

    // The invocation should have activation info.
    expect(inv.activation).toBeDefined();
    expect(inv.activation!.activated).toBe(true);
    expect(inv.activation!.root.path).toBe(root);
  });

  it('is idempotent — second call returns the same activation', () => {
    const root = join(tmpDir, 'fake-esp-idf');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'idf.py'), '');
    writeFileSync(join(root, 'export.sh'), '');
    writeFileSync(join(root, 'export.bat'), '');
    process.env.IDF_PATH = root;

    const projDir = join(tmpDir, 'proj');
    mkdirSync(projDir);

    const inv1 = idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });
    const inv2 = idfSpawn(projDir, ['build'], { cwd: projDir, encoding: 'utf8' });
    expect(inv2.activation).toBeDefined();
    expect(inv2.activation!.root.path).toBe(inv1.activation!.root.path);
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

describe('resolveVersionedBinary', () => {
  const exe = IS_WIN ? '.exe' : '';

  it('prefers the bare-named binary when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttlefish-bin-'));
    try {
      writeFileSync(join(dir, `gdb${exe}`), '');
      writeFileSync(join(dir, `gdb-3.9${exe}`), '');
      const result = resolveVersionedBinary(dir.replace(/\\/g, '/'), 'gdb', exe);
      expect(result).toBe(`${dir.replace(/\\/g, '/')}/gdb${exe}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('picks the highest version-suffixed sibling (component-wise, not float)', () => {
    // Float math would rank 3.9 > 3.14 and 3.10 < 3.9 — both wrong.
    const dir = mkdtempSync(join(tmpdir(), 'cuttlefish-bin-'));
    try {
      for (const v of ['3.8', '3.9', '3.10', '3.14']) {
        writeFileSync(join(dir, `xtensa-esp-elf-gdb-${v}${exe}`), '');
      }
      const result = resolveVersionedBinary(dir.replace(/\\/g, '/'), 'xtensa-esp-elf-gdb', exe);
      expect(result).toMatch(/xtensa-esp-elf-gdb-3\.14/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles multi-component versions like 3.9.1 > 3.9', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttlefish-bin-'));
    try {
      writeFileSync(join(dir, `gdb-3.9${exe}`), '');
      writeFileSync(join(dir, `gdb-3.9.1${exe}`), '');
      const result = resolveVersionedBinary(dir.replace(/\\/g, '/'), 'gdb', exe);
      expect(result).toMatch(/gdb-3\.9\.1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no matching binary exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttlefish-bin-'));
    try {
      const result = resolveVersionedBinary(dir.replace(/\\/g, '/'), 'gdb', exe);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveEspToolchains', () => {
  // Best-effort smoke: depends on the host having ESP-IDF installed. When it
  // does, we assert the resolved shape (absolute paths, correct binary names).
  // When it doesn't, we only assert it returns null (the documented fallback).
  it('returns null or a valid {gdbPath, openocdPath} shape, never throws', () => {
    const result = resolveEspToolchains();
    if (result === null) {
      expect(result).toBeNull();
      return;
    }
    expect(typeof result.gdbPath).toBe('string');
    expect(typeof result.openocdPath).toBe('string');
    // gdbPath must resolve to an xtensa GDB executable.
    expect(result.gdbPath).toMatch(/xtensa-esp[a-z0-9-]*-elf-gdb/);
    // openocdPath must resolve to an OpenOCD executable.
    expect(result.openocdPath).toMatch(/openocd/i);
    // Drive-letter paths on Windows must be intact (no lost C: prefix).
    if (IS_WIN) {
      expect(result.gdbPath).toMatch(/^[A-Z]:\//);
      expect(result.openocdPath).toMatch(/^[A-Z]:\//);
    }
  });
});
