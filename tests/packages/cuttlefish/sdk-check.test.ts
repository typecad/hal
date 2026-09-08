// ---------------------------------------------------------------------------
// sdk.test.ts — the installed-SDK gate: fingerprint, pin compare, and the
// create-time assertion. Fixture trees (not the dev machine's ~/zephyrproject)
// drive every case; $ZEPHYR_BASE is authoritative so isolation holds.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  PINNED_ZEPHYR_MANIFEST_REV,
  PINNED_ZEPHYR_SDK_VERSION,
  sdkFingerprint,
  checkZephyrSdk,
  assertZephyrSdkForCreate,
  locateZephyrBaseCheap,
} from '../../../packages/cuttlefish/src/board-catalog/index';

/** A minimal Zephyr tree at the given version. */
function fixtureTree(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sdk-'));
  const tree = path.join(root, 'zephyr');
  fs.mkdirSync(path.join(tree, 'include', 'zephyr'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'CMakeLists.txt'), '# fixture\n');
  fs.writeFileSync(path.join(tree, 'include', 'zephyr', 'kernel.h'), '# fixture\n');
  const [major, minor, patch] = version.split('.');
  fs.writeFileSync(path.join(tree, 'VERSION'),
    `VERSION_MAJOR = ${major}\nVERSION_MINOR = ${minor}\nPATCHLEVEL = ${patch}\n`);
  return tree;
}

describe('sdk fingerprint', () => {
  it('hashes version + git HEAD; stable for the same tree, different when the tree moves', () => {
    const tree = fixtureTree(PINNED_ZEPHYR_MANIFEST_REV.replace(/^v/, ''));
    const fp1 = sdkFingerprint(tree);
    const fp2 = sdkFingerprint(tree);
    expect(fp1).toBeDefined();
    expect(fp1).toBe(fp2);
    // Move the tree ahead → different fingerprint.
    fs.writeFileSync(path.join(tree, 'VERSION'), 'VERSION_MAJOR = 9\nVERSION_MINOR = 9\nPATCHLEVEL = 9\n');
    expect(sdkFingerprint(tree)).not.toBe(fp1);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it('is undefined for a non-tree', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sdk-empty-'));
    expect(sdkFingerprint(empty)).toBeUndefined();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('checkZephyrSdk', () => {
  it('ok at the pinned version', () => {
    const tree = fixtureTree(PINNED_ZEPHYR_MANIFEST_REV.replace(/^v/, ''));
    const check = checkZephyrSdk(tree);
    expect(check.status).toBe('ok');
    if (check.status === 'ok') {
      expect(check.version).toBe(check.pinnedVersion);
      expect(check.fingerprint).toBe(sdkFingerprint(tree));
    }
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it('version-mismatch on a different version (toolchain not picked up — the real installer SDK is global)', () => {
    const tree = fixtureTree('9.9.9');
    const check = checkZephyrSdk(tree);
    expect(check.status).toBe('version-mismatch');
    if (check.status === 'version-mismatch') {
      // The sibling-scan may find the machine's real toolchain SDK beside
      // nothing — but the env-vars probe is global, so toolchainVersion can
      // be the real 1.0.1. The TREE version is what the pin compares.
      expect(check.version).toBe('9.9.9');
      expect(check.pinnedVersion).toBe(PINNED_ZEPHYR_MANIFEST_REV.replace(/^v/, ''));
    }
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it('missing for a non-tree', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sdk-none-'));
    expect(checkZephyrSdk(empty).status).toBe('missing');
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('$ZEPHYR_BASE is authoritative', () => {
  const saved = process.env.ZEPHYR_BASE;
  afterEach(() => {
    if (saved === undefined) delete process.env.ZEPHYR_BASE;
    else process.env.ZEPHYR_BASE = saved;
  });

  it('a set-but-invalid ZEPHYR_BASE yields no tree (no well-known fallback)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sdk-invalid-'));
    process.env.ZEPHYR_BASE = empty;
    // On a machine with a real ~/zephyrproject this must STILL be undefined.
    expect(locateZephyrBaseCheap()).toBeUndefined();
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('a valid ZEPHYR_BASE wins', () => {
    const tree = fixtureTree('1.2.3');
    process.env.ZEPHYR_BASE = tree;
    expect(locateZephyrBaseCheap()).toBe(path.resolve(tree));
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });
});

describe('assertZephyrSdkForCreate (the create gate)', () => {
  const savedBase = process.env.ZEPHYR_BASE;
  const savedCheck = process.env.TYPECAD_HAL_SDK_CHECK;
  afterEach(() => {
    if (savedBase === undefined) delete process.env.ZEPHYR_BASE;
    else process.env.ZEPHYR_BASE = savedBase;
    if (savedCheck === undefined) delete process.env.TYPECAD_HAL_SDK_CHECK;
    else process.env.TYPECAD_HAL_SDK_CHECK = savedCheck;
  });

  it('throws with the install command when no SDK is installed', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sdk-gate-'));
    process.env.ZEPHYR_BASE = empty;
    delete process.env.TYPECAD_HAL_SDK_CHECK;
    expect(() => assertZephyrSdkForCreate()).toThrow(/zephyr-installer/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('throws with re-pin guidance on a version mismatch', () => {
    const tree = fixtureTree('9.9.9');
    process.env.ZEPHYR_BASE = tree;
    delete process.env.TYPECAD_HAL_SDK_CHECK;
    expect(() => assertZephyrSdkForCreate()).toThrow(/does not match[\s\S]*zephyr-installer/);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it('passes at the pin; TYPECAD_HAL_SDK_CHECK=off bypasses any state', () => {
    const tree = fixtureTree(PINNED_ZEPHYR_MANIFEST_REV.replace(/^v/, ''));
    process.env.ZEPHYR_BASE = tree;
    delete process.env.TYPECAD_HAL_SDK_CHECK;
    expect(() => assertZephyrSdkForCreate()).not.toThrow();
    process.env.TYPECAD_HAL_SDK_CHECK = 'off';
    process.env.ZEPHYR_BASE = path.join(path.dirname(tree), 'not-a-tree');
    expect(() => assertZephyrSdkForCreate()).not.toThrow();
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });
});

describe('workspace pin drift guard', () => {
  it('mirrors framework-zephyr installer/versions.env exactly', () => {
    const env = fs.readFileSync(
      path.join(__dirname, '../../../packages/framework-zephyr/installer/versions.env'),
      'utf8',
    );
    const rev = env.match(/^ZEPHYR_MANIFEST_REV=(.+)$/m)?.[1]?.trim();
    const sdk = env.match(/^ZEPHYR_SDK_VERSION=(.+)$/m)?.[1]?.trim();
    expect(rev, 'versions.env ZEPHYR_MANIFEST_REV').toBe(PINNED_ZEPHYR_MANIFEST_REV);
    expect(sdk, 'versions.env ZEPHYR_SDK_VERSION').toBe(PINNED_ZEPHYR_SDK_VERSION);
  });
});
