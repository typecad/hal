import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateLibraryPackage } from '../../../packages/cuttlefish/src/library/validate';

// ---------------------------------------------------------------------------
// `typecad-hal library validate` — the checks that used to surface only at
// import time, plus the AUTOSAR strict pass over the shim bytes.
// ---------------------------------------------------------------------------

function writeValidPackage(dir: string, mutate?: (dir: string) => void): void {
  mkdirSync(join(dir, 'shims'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@acme/demo-lib',
      files: ['dist', 'src', 'shims', 'typecad-hal.library.json'],
      keywords: ['typecad-hal-library', 'typecad-hal-sensor'],
    }),
  );
  writeFileSync(
    join(dir, 'typecad-hal.library.json'),
    JSON.stringify({
      id: 'demo-lib',
      module: '@acme/demo-lib',
      framework: 'zephyr',
      include: '"__tc_demo_lib.h"',
      gateToken: '__tc_demo_lib',
      shims: [
        { path: 'shims/__tc_demo_lib.h', outName: '__tc_demo_lib.h' },
        { path: 'shims/__tc_demo_lib.cpp', outName: '__tc_demo_lib.cpp' },
      ],
    }),
  );
  writeFileSync(
    join(dir, 'shims', '__tc_demo_lib.h'),
    '#ifndef TC_DEMO_LIB_H_\n#define TC_DEMO_LIB_H_\n#include <cstdint>\nclass DemoLib final\n{\npublic:\n  DemoLib& begin();\nprivate:\n  bool initialized_ = false;\n};\nextern DemoLib demoLib;\n#endif\n',
  );
  writeFileSync(
    join(dir, 'shims', '__tc_demo_lib.cpp'),
    '#include "__tc_demo_lib.h"\n\nDemoLib& DemoLib::begin()\n{\n  initialized_ = true;\n  return *this;\n}\n\nDemoLib demoLib;\n',
  );
  mutate?.(dir);
}

function readJson(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

function writeJson(dir: string, file: string, json: unknown): void {
  writeFileSync(join(dir, file), JSON.stringify(json, null, 2));
}

describe('library validate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tc-lib-validate-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a well-formed package', () => {
    writeValidPackage(dir);
    const report = validateLibraryPackage(dir);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('fails without a manifest', () => {
    const report = validateLibraryPackage(dir);
    expect(report.valid).toBe(false);
    expect(report.errors.join('\n')).toMatch(/typecad-hal.library.json not found/);
  });

  it('fails when a manifest-listed shim file is missing', () => {
    writeValidPackage(dir, (d) => {
      rmSync(join(d, 'shims', '__tc_demo_lib.cpp'));
    });
    const report = validateLibraryPackage(dir);
    expect(report.errors.join('\n')).toMatch(/missing: shims\/__tc_demo_lib\.cpp/);
  });

  it('fails when the gate token does not appear in the include', () => {
    writeValidPackage(dir, (d) => {
      const manifest = readJson(d, 'typecad-hal.library.json');
      manifest.gateToken = '__tc_something_else';
      writeJson(d, 'typecad-hal.library.json', manifest);
    });
    const report = validateLibraryPackage(dir);
    expect(report.errors.join('\n')).toMatch(/gate token '__tc_something_else' does not appear/);
  });

  it('fails when manifest module and package name disagree', () => {
    writeValidPackage(dir, (d) => {
      const manifest = readJson(d, 'typecad-hal.library.json');
      manifest.module = '@acme/other-name';
      writeJson(d, 'typecad-hal.library.json', manifest);
    });
    const report = validateLibraryPackage(dir);
    expect(report.errors.join('\n')).toMatch(/must equal the package\.json name/);
  });

  it('fails when the marker keyword is missing from package.json', () => {
    writeValidPackage(dir, (d) => {
      writeJson(d, 'package.json', { name: '@acme/demo-lib', keywords: ['sensor-stuff'] });
    });
    const report = validateLibraryPackage(dir);
    expect(report.errors.join('\n')).toMatch(/must include the marker 'typecad-hal-library'/);
  });

  it('warns (not errors) when the category keyword is absent or unknown', () => {
    writeValidPackage(dir, (d) => {
      writeJson(d, 'package.json', { name: '@acme/demo-lib', keywords: ['typecad-hal-library', 'typecad-hal-mystery'] });
    });
    const report = validateLibraryPackage(dir);
    expect(report.valid).toBe(true);
    expect(report.warnings.join('\n')).toMatch(/typecad-hal-mystery/);
  });

  it('fails when a shim carries a C-style cast (AUTOSAR strict)', () => {
    writeValidPackage(dir, (d) => {
      writeFileSync(
        join(d, 'shims', '__tc_demo_lib.cpp'),
        '#include "__tc_demo_lib.h"\n\nDemoLib& DemoLib::begin()\n{\n  int y = 2;\n  int x = (int)y;\n  initialized_ = x == y;\n  return *this;\n}\n\nDemoLib demoLib;\n',
      );
    });
    const report = validateLibraryPackage(dir);
    expect(report.valid).toBe(false);
    expect(report.autosarFindings.length).toBeGreaterThan(0);
    expect(report.errors.join('\n')).toMatch(/AUTOSAR/);
  });

  it('fails when package.json files would not ship the manifest', () => {
    writeValidPackage(dir, (d) => {
      writeJson(d, 'package.json', {
        name: '@acme/demo-lib',
        keywords: ['typecad-hal-library', 'typecad-hal-sensor'],
        files: ['dist'],
      });
    });
    const report = validateLibraryPackage(dir);
    expect(report.errors.join('\n')).toMatch(/must include 'typecad-hal.library.json'/);
  });
});
