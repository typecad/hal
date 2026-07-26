import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWrapperContent, ensureIdfActivated, idfSpawn, wrapperPathFor, WRAPPER_NAME,
  resolveEspToolchains, selectGdbBinary,
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

describe('selectGdbBinary', () => {
  const exe = IS_WIN ? '.exe' : '';

  it('prefers the per-target binary when it exists (IDF v6 layout)', () => {
    // IDF v6 ships per-target binaries (xtensa-esp32s3-elf-gdb.exe) alongside
    // the unified toolchain. The per-target binary is linked against host
    // Python and runs reliably; prefer it over the Python-suffixed unified ones.
    const entries = [
      `xtensa-esp-elf-gdb-3.13${exe}`,
      `xtensa-esp-elf-gdb-3.14${exe}`,  // would fail: no Python 3.14 installed
      `xtensa-esp-elf-gdb-no-python${exe}`,
      `xtensa-esp32s3-elf-gdb${exe}`,
    ];
    expect(selectGdbBinary(entries, 'esp32s3')).toBe(`xtensa-esp32s3-elf-gdb${exe}`);
  });

  it('falls back to xtensa-esp-elf-gdb-no-python when no per-target binary', () => {
    const entries = [
      `xtensa-esp-elf-gdb-3.13${exe}`,
      `xtensa-esp-elf-gdb-3.14${exe}`,
      `xtensa-esp-elf-gdb-no-python${exe}`,
    ];
    expect(selectGdbBinary(entries, 'esp32s3')).toBe(`xtensa-esp-elf-gdb-no-python${exe}`);
  });

  it('falls back to bare xtensa-esp-elf-gdb when present (older IDF layout)', () => {
    const entries = [`xtensa-esp-elf-gdb${exe}`, `xtensa-esp-elf-gdb-3.8${exe}`];
    expect(selectGdbBinary(entries, 'esp32s3')).toBe(`xtensa-esp-elf-gdb${exe}`);
  });

  it('last resort: picks the first version-suffixed variant alphabetically', () => {
    const entries = [`xtensa-esp-elf-gdb-3.14${exe}`, `xtensa-esp-elf-gdb-3.8${exe}`];
    // Sorted alphabetically: 3.14 < 3.8 (string comparison), so 3.14 wins.
    // This is a last resort — we don't try to be clever about version ordering
    // because the suffix is a Python ABI tag, not a GDB version.
    expect(selectGdbBinary(entries, 'esp32s3')).toBe(`xtensa-esp-elf-gdb-3.14${exe}`);
  });

  it('returns null when no GDB binary exists', () => {
    expect(selectGdbBinary([], 'esp32s3')).toBeNull();
    expect(selectGdbBinary(['unrelated.exe'])).toBeNull();
  });

  it('without a target, skips the per-target lookup', () => {
    const entries = [`xtensa-esp32s3-elf-gdb${exe}`, `xtensa-esp-elf-gdb-no-python${exe}`];
    expect(selectGdbBinary(entries)).toBe(`xtensa-esp-elf-gdb-no-python${exe}`);
  });
});

describe('resolveEspToolchains', () => {
  // Best-effort smoke: depends on the host having ESP-IDF installed. When it
  // does, we assert the resolved shape (absolute paths, correct binary names).
  // When it doesn't, we only assert it returns null (the documented fallback).
  it('returns null or a valid toolchain shape, never throws', () => {
    const result = resolveEspToolchains('esp32s3');
    if (result === null) {
      expect(result).toBeNull();
      return;
    }
    expect(typeof result.gdbPath).toBe('string');
    expect(typeof result.openocdPath).toBe('string');
    expect(typeof result.openocdScripts).toBe('string');
    // gdbPath must resolve to an xtensa GDB executable.
    expect(result.gdbPath).toMatch(/xtensa-esp[a-z0-9-]*-elf-gdb/);
    // openocdPath must resolve to an OpenOCD executable.
    expect(result.openocdPath).toMatch(/openocd/i);
    // openocdScripts must point at the scripts dir (where board/*.cfg live).
    expect(result.openocdScripts.toLowerCase()).toMatch(/openocd.*scripts|scripts.*openocd/);
    // Drive-letter paths on Windows must be intact (no lost C: prefix).
    if (IS_WIN) {
      expect(result.gdbPath).toMatch(/^[A-Z]:\//);
      expect(result.openocdPath).toMatch(/^[A-Z]:\//);
      expect(result.openocdScripts).toMatch(/^[A-Z]:\//);
    }
  });
});
