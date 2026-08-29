import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runLibraryInit } from '../../../packages/cuttlefish/src/library/init';
import { validateLibraryPackage } from '../../../packages/cuttlefish/src/library/validate';

// ---------------------------------------------------------------------------
// `cuttlefish library init` scaffolding — the generated package must be a
// valid library package the moment it lands: complete file set, manifest
// fields, taxonomy keywords, and a round-trip pass through `library validate`
// (including the AUTOSAR strict pass over the generated shim stubs).
// ---------------------------------------------------------------------------

describe('library init scaffold', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tc-lib-init-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function scaffold(overrides: Partial<Parameters<typeof runLibraryInit>[0]> = {}) {
    return runLibraryInit({
      name: '@acme/led-ring',
      framework: 'zephyr',
      category: 'led',
      targets: 'esp32s3_devkitc, esp32c3_devkitm/esp32c3',
      dir: join(root, 'led-ring'),
      yes: true,
      ...overrides,
    });
  }

  it('generates the full Zephyr file set with derived names', async () => {
    const result = await scaffold();
    expect(result.id).toBe('led-ring');

    const pkg = JSON.parse(readFileSync(join(result.packageDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@acme/led-ring');
    expect(pkg.keywords).toContain('cuttlefish-library');
    expect(pkg.keywords).toContain('cuttlefish-led');
    expect(pkg.files).toContain('cuttlefish.library.json');

    const manifest = JSON.parse(readFileSync(join(result.packageDir, 'cuttlefish.library.json'), 'utf8'));
    expect(manifest.module).toBe('@acme/led-ring');
    expect(manifest.framework).toBe('zephyr');
    expect(manifest.targets).toEqual(['esp32s3_devkitc', 'esp32c3_devkitm/esp32c3']);
    expect(manifest.include).toBe('"__tc_led_ring.h"');
    expect(manifest.gateToken).toBe('__tc_led_ring');
    expect(manifest.overlay).toBe('shims/led-ring.overlay');

    for (const rel of [
      'tsconfig.json',
      'src/index.ts',
      'shims/__tc_led_ring.h',
      'shims/__tc_led_ring.cpp',
      'shims/led-ring.overlay',
      'README.md',
      'tests/library.test.ts',
    ]) {
      expect(existsSync(join(result.packageDir, rel)), rel).toBe(true);
    }

    // The typed API and the C++ shim agree on the load-bearing names.
    const api = readFileSync(join(result.packageDir, 'src/index.ts'), 'utf8');
    const header = readFileSync(join(result.packageDir, 'shims/__tc_led_ring.h'), 'utf8');
    expect(api).toContain('export class LedRing');
    expect(api).toContain('export const ledRing');
    expect(header).toContain('class LedRing final');
    expect(header).toContain('extern LedRing ledRing;');
  });

  it('omits kconfig and the overlay fragment for non-Zephyr frameworks', async () => {
    const result = await scaffold({
      name: 'my-sensor',
      framework: 'native',
      category: 'sensor',
      targets: '',
    });
    const manifest = JSON.parse(readFileSync(join(result.packageDir, 'cuttlefish.library.json'), 'utf8'));
    expect(manifest.framework).toBe('native');
    expect(manifest.kconfig).toBeUndefined();
    expect(manifest.overlay).toBeUndefined();
    expect(manifest.targets).toBeUndefined();
    expect(existsSync(join(result.packageDir, 'shims', 'my-sensor.overlay'))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(result.packageDir, 'package.json'), 'utf8'));
    expect(pkg.keywords).toContain('cuttlefish-sensor');
  });

  it('round-trips: the scaffold passes library validate', async () => {
    const result = await scaffold();
    const report = validateLibraryPackage(result.packageDir);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('rejects invalid names, frameworks, and categories, and non-empty dirs', async () => {
    await expect(scaffold({ name: 'not a name!' })).rejects.toThrow(/valid npm package name/i);
    await expect(scaffold({ framework: 'nope' })).rejects.toThrow(/Unknown framework/i);
    await expect(scaffold({ category: 'nope' })).rejects.toThrow(/Unknown category/i);
    const once = await scaffold();
    await expect(scaffold({ dir: once.packageDir })).rejects.toThrow(/not empty/i);
  });
});
