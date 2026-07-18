import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldEspIdfProject } from '../../../packages/framework-esp32/src/toolchain/scaffold';

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

  it('writes .gitignore with build/ and sdkconfig', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const gi = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(gi).toMatch(/^build\//m);
    expect(gi).toMatch(/^sdkconfig$/m);
  });

  it('is idempotent — overwrites without error on second call', () => {
    scaffoldEspIdfProject(tmpDir, 'esp32');
    writeFileSync(join(tmpDir, 'sdkconfig.defaults'), '# user edit');
    scaffoldEspIdfProject(tmpDir, 'esp32');
    const cfg = readFileSync(join(tmpDir, 'sdkconfig.defaults'), 'utf8');
    expect(cfg).toMatch(/CONFIG_IDF_TARGET="esp32"/);
  });
});
