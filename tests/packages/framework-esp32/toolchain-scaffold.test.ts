import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldEspIdfProject } from '../../../packages/framework-esp32/src/toolchain/scaffold';
import { projectRootFromOptions } from '../../../packages/framework-esp32/src/toolchain/index';

describe('projectRootFromOptions', () => {
  it('returns parent of outputDir when outputDir basename is "main"', () => {
    const o = { outputDir: '/proj/out/main', sourcePath: '/proj/out/main/main.cc' } as any;
    expect(projectRootFromOptions(o)).toBe('/proj/out');
  });
  it('returns outputDir unchanged when basename is not "main"', () => {
    const o = { outputDir: '/proj/some-other', sourcePath: '/proj/some-other/main.cc' } as any;
    expect(projectRootFromOptions(o)).toBe('/proj/some-other');
  });
  it('handles Windows-style paths', () => {
    const o = { outputDir: 'C:\\proj\\out\\main', sourcePath: 'C:\\proj\\out\\main\\main.cc' } as any;
    // basename uses platform separator; on Windows this is backslash.
    // Just assert it doesn't throw and returns a string ending in 'out'.
    const result = projectRootFromOptions(o);
    expect(result).toMatch(/[\\/]out$/);
  });
});

let tmpDir: string;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'tc-scaffold-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('scaffoldEspIdfProject', () => {
  it('creates root CMakeLists.txt with project name from dir basename', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const cmake = readFileSync(join(tmpDir, 'CMakeLists.txt'), 'utf8');
    expect(cmake).toMatch(/cmake_minimum_required/);
    expect(cmake).toMatch(/include\(\$ENV\{IDF_PATH\}\/tools\/cmake\/project\.cmake\)/);
    const base = tmpDir.replace(/.*[\\/]/, '');
    expect(cmake).toMatch(new RegExp(`project\\("${base}"\\)`));
  });

  it('creates main/CMakeLists.txt registering main.cc', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const cmake = readFileSync(join(tmpDir, 'main', 'CMakeLists.txt'), 'utf8');
    expect(cmake).toMatch(/idf_component_register/);
    expect(cmake).toMatch(/SRCS "main\.cc"/);
  });

  it('writes sdkconfig.defaults with CONFIG_IDF_TARGET for the given target', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32s3');
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_IDF_TARGET="esp32s3"/);
    expect(cfg).toMatch(/CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y/);
  });

  it('writes .gitignore with build/, sdkconfig, and cuttlefish-idf-env.*', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const gi = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(gi).toMatch(/^build\//m);
    expect(gi).toMatch(/^sdkconfig$/m);
    expect(gi).toMatch(/^cuttlefish-idf-env\.sh$/m);
    expect(gi).toMatch(/^cuttlefish-idf-env\.bat$/m);
  });

  it('is idempotent — overwrites without error on second call', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    writeFileSync(join(tmpDir, 'sdkconfig.defaults'), '# user edit');
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_IDF_TARGET="esp32"/);
  });
});

describe('scaffoldEspIdfProject — PSRAM config', () => {
  it('emits CONFIG_SPIRAM_MODE_OCT + 80M speed for esp32s3 + psram:opi', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32s3', {
      managed: {}, local: [], builtin: [], psram: 'opi',
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_SPIRAM=y/);
    expect(cfg).toMatch(/CONFIG_SPIRAM_MODE_OCT=y/);
    expect(cfg).toMatch(/CONFIG_SPIRAM_SPEED_80M=y/);
    expect(cfg).toMatch(/CONFIG_SPIRAM_USE_MALLOC=y/);
    // Quad mode should NOT appear when opi is selected.
    expect(cfg).not.toMatch(/CONFIG_SPIRAM_MODE_QUAD/);
  });

  it('emits CONFIG_SPIRAM_MODE_QUAD + 40M speed for esp32s3 + psram:quad', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32s3', {
      managed: {}, local: [], builtin: [], psram: 'quad',
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_SPIRAM=y/);
    expect(cfg).toMatch(/CONFIG_SPIRAM_MODE_QUAD=y/);
    expect(cfg).toMatch(/CONFIG_SPIRAM_SPEED_40M=y/);
    expect(cfg).not.toMatch(/CONFIG_SPIRAM_MODE_OCT/);
  });

  it('emits NO CONFIG_SPIRAM lines when psram is false (regression guard)', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32s3', {
      managed: {}, local: [], builtin: [], psram: false,
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).not.toMatch(/CONFIG_SPIRAM/);
  });

  it('emits NO CONFIG_SPIRAM lines when components is omitted (default)', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32s3');
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).not.toMatch(/CONFIG_SPIRAM/);
  });

  it('skips PSRAM config for unsupported target (esp32c3 + opi)', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32c3', {
      managed: {}, local: [], builtin: [], psram: 'opi',
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).not.toMatch(/CONFIG_SPIRAM=y/);
    // Should explain why it was skipped.
    expect(cfg).toMatch(/no PSRAM-capable variant/);
  });

  it('emits PSRAM config for esp32 (classic) + quad', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32', {
      managed: {}, local: [], builtin: [], psram: 'quad',
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_SPIRAM_MODE_QUAD=y/);
  });

  it('emits PSRAM config for esp32c6 + opi', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32c6', {
      managed: {}, local: [], builtin: [], psram: 'opi',
    });
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_SPIRAM_MODE_OCT=y/);
  });
});
