import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverIdfRoot, discoverFromEnv, discoverFromWellKnown, discoverFromVersionScan,
  detectIdfVersion, compareSemver, eimManifestPath, wellKnownPaths, versionScanParents,
} from '../../../packages/framework-esp32/src/toolchain/discover';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake IDF root in a temp dir: writes tools/idf.py, export.sh, export.bat,
 *  and a tools/cmake/version.cmake carrying the given version. Returns the root path. */
function makeFakeIdfRoot(parent: string, name: string, version: string = '5.0.0'): string {
  const root = join(parent, name);
  mkdirSync(join(root, 'tools', 'cmake'), { recursive: true });
  writeFileSync(join(root, 'tools', 'idf.py'), '# fake idf.py\n');
  writeFileSync(join(root, 'export.sh'), '# fake export.sh\n');
  writeFileSync(join(root, 'export.bat'), '@echo off\nREM fake export.bat\n');
  const [major, minor, patch] = version.split('.');
  writeFileSync(join(root, 'tools', 'cmake', 'version.cmake'),
    `set(IDF_VERSION_MAJOR ${major})\nset(IDF_VERSION_MINOR ${minor})\nset(IDF_VERSION_PATCH ${patch})\n`);
  return root;
}

let tmpDir: string;
const ORIG_IDF_PATH = process.env.IDF_PATH;
const ORIG_HOME = process.env.HOME;
const ORIG_SYSTEMDRIVE = process.env.SystemDrive;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'tc-discover-')); });
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (ORIG_IDF_PATH === undefined) delete process.env.IDF_PATH;
  else process.env.IDF_PATH = ORIG_IDF_PATH;
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_SYSTEMDRIVE === undefined) delete process.env.SystemDrive;
  else process.env.SystemDrive = ORIG_SYSTEMDRIVE;
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('orders major versions', () => {
    expect(compareSemver('6.0.0', '5.5.5')).toBeGreaterThan(0);
    expect(compareSemver('5.0.0', '6.0.0')).toBeLessThan(0);
  });
  it('orders minor versions', () => {
    expect(compareSemver('5.5.0', '5.4.99')).toBeGreaterThan(0);
  });
  it('orders patch versions', () => {
    expect(compareSemver('5.5.5', '5.5.4')).toBeGreaterThan(0);
  });
  it('equal versions return 0', () => {
    expect(compareSemver('5.5.5', '5.5.5')).toBe(0);
  });
  it('undefined sorts lowest', () => {
    expect(compareSemver(undefined, '1.0.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0', undefined)).toBeGreaterThan(0);
  });
});

describe('detectIdfVersion', () => {
  it('parses version.cmake', () => {
    const root = makeFakeIdfRoot(tmpDir, 'fake', '6.0.2');
    expect(detectIdfVersion(root)).toBe('6.0.2');
  });
  it('returns undefined when version.cmake is missing', () => {
    const root = join(tmpDir, 'no-version');
    mkdirSync(join(root, 'tools'), { recursive: true });
    expect(detectIdfVersion(root)).toBeUndefined();
  });
});

// ── Strategy 1: $IDF_PATH env var ─────────────────────────────────────────────

describe('discoverFromEnv', () => {
  it('returns the root when IDF_PATH points at a valid IDF root', () => {
    const root = makeFakeIdfRoot(tmpDir, 'fake', '5.0.0');
    process.env.IDF_PATH = root;
    const result = discoverFromEnv();
    expect(result).not.toBeNull();
    expect(result!.path).toBe(root);
    expect(result!.source).toBe('env');
    expect(result!.version).toBe('5.0.0');
  });
  it('returns null when IDF_PATH is unset', () => {
    delete process.env.IDF_PATH;
    expect(discoverFromEnv()).toBeNull();
  });
  it('returns null when IDF_PATH points at a non-IDF directory', () => {
    process.env.IDF_PATH = tmpDir;  // empty temp dir, no tools/idf.py
    expect(discoverFromEnv()).toBeNull();
  });
});

// ── Strategy 3: well-known paths ─────────────────────────────────────────────

describe('discoverFromWellKnown', () => {
  it('finds a root from a provided list of well-known paths', () => {
    const root = makeFakeIdfRoot(tmpDir, 'esp-idf', '5.5.1');
    // Inject the parent — discoverFromWellKnown takes a list of ROOT candidates,
    // so pass the root directly.
    const result = discoverFromWellKnown([root]);
    expect(result).not.toBeNull();
    expect(result!.path).toBe(root);
    expect(result!.source).toBe('well-known');
  });
  it('returns null when no candidate is a valid root', () => {
    expect(discoverFromWellKnown([join(tmpDir, 'nope1'), join(tmpDir, 'nope2')])).toBeNull();
  });
  it('returns the first match when multiple candidates are valid', () => {
    const root1 = makeFakeIdfRoot(tmpDir, 'a', '5.0.0');
    const root2 = makeFakeIdfRoot(tmpDir, 'b', '6.0.0');
    const result = discoverFromWellKnown([root1, root2]);
    expect(result!.path).toBe(root1);  // first wins, not highest
  });
});

// ── Strategy 4: version-tagged parent scan ───────────────────────────────────

describe('discoverFromVersionScan', () => {
  it('finds a single version-tagged root', () => {
    // Layout: <parent>/v6.0.2/esp-idf/
    const parent = join(tmpDir, 'esp');
    const root = makeFakeIdfRoot(join(parent, 'v6.0.2'), 'esp-idf', '6.0.2');
    const result = discoverFromVersionScan([parent]);
    expect(result).not.toBeNull();
    expect(result!.path).toBe(root);
    expect(result!.source).toBe('version-scan');
    expect(result!.version).toBe('6.0.2');
  });
  it('picks the highest version when multiple are present', () => {
    const parent = join(tmpDir, 'esp');
    makeFakeIdfRoot(join(parent, 'v5.0.0'), 'esp-idf', '5.0.0');
    const v6 = makeFakeIdfRoot(join(parent, 'v6.0.2'), 'esp-idf', '6.0.2');
    makeFakeIdfRoot(join(parent, 'v4.4.5'), 'esp-idf', '4.4.5');
    const result = discoverFromVersionScan([parent]);
    expect(result!.path).toBe(v6);
    expect(result!.version).toBe('6.0.2');
  });
  it('returns null when the parent has no esp-idf subdirs', () => {
    mkdirSync(join(tmpDir, 'empty'), { recursive: true });
    expect(discoverFromVersionScan([join(tmpDir, 'empty')])).toBeNull();
  });
  it('returns null when the parent does not exist', () => {
    expect(discoverFromVersionScan([join(tmpDir, 'does-not-exist')])).toBeNull();
  });
  it('infers version from directory name when version.cmake is missing', () => {
    const parent = join(tmpDir, 'esp');
    // Make a root WITHOUT a version.cmake
    const root = join(parent, 'v6.0.2', 'esp-idf');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'idf.py'), '');
    writeFileSync(join(root, 'export.sh'), '');
    const result = discoverFromVersionScan([parent]);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('6.0.2');  // from dir segment
  });
  it('scans multiple parents and picks highest across all', () => {
    const parent1 = join(tmpDir, 'a');
    const parent2 = join(tmpDir, 'b');
    makeFakeIdfRoot(join(parent1, 'v5.0.0'), 'esp-idf', '5.0.0');
    const v6 = makeFakeIdfRoot(join(parent2, 'v6.0.0'), 'esp-idf', '6.0.0');
    const result = discoverFromVersionScan([parent1, parent2]);
    expect(result!.path).toBe(v6);
  });
});

// ── Cascade ───────────────────────────────────────────────────────────────────

describe('discoverIdfRoot cascade', () => {
  it('returns null when nothing is found and no env set', () => {
    delete process.env.IDF_PATH;
    // Point well-known + version-scan at empty dirs so they don't hit real installs.
    // We can't easily override the cascade's internal calls, but with empty/missing
    // parents and no PATH idf.py, it should return null. Skip if the host actually
    // has ESP-IDF installed somewhere we'd find.
    const result = discoverIdfRoot();
    if (result && existsSync(join(result.path, 'tools', 'idf.py'))) {
      // Host has a real install; can't assert null. Just assert the shape is sane.
      expect(['env', 'eim-manifest', 'well-known', 'version-scan', 'path']).toContain(result.source);
    } else {
      expect(result).toBeNull();
    }
  });
});

// ── Path helpers (smoke) ─────────────────────────────────────────────────────

describe('path helpers', () => {
  it('eimManifestPath returns a string ending in eim_idf.json', () => {
    expect(eimManifestPath()).toMatch(/eim_idf\.json$/);
  });
  it('wellKnownPaths returns a non-empty array', () => {
    expect(wellKnownPaths().length).toBeGreaterThan(0);
  });
  it('versionScanParents returns a non-empty array', () => {
    expect(versionScanParents().length).toBeGreaterThan(0);
  });
});
