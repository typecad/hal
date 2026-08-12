import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dispatcher (install.mjs) is the universal entry point: `node install.mjs`
// delegates to install.sh (POSIX) or install.ps1 (Windows). This test covers
// both the flag translation (which runs on Windows only — unit-tested here on
// any host by importing the function) and the end-to-end delegation (run the
// dispatcher in dry-run and assert the native script's [plan] comes through).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/zephyr-installer');

// Importing install.mjs must NOT trigger a dispatch (the isMain guard).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs has no type decl; we only use it as a plain function.
import { translateToPwsh } from '../../../packages/zephyr-installer/install.mjs';

describe('install.mjs flag translation (POSIX → PowerShell)', () => {
  it('maps each documented flag to its PowerShell param name', () => {
    expect(translateToPwsh(['--dry-run'])).toEqual(['-DryRun']);
    expect(translateToPwsh(['--no-sdk'])).toEqual(['-NoSdk']);
    expect(translateToPwsh(['--no-workspace'])).toEqual(['-NoWorkspace']);
  });

  it('consumes the value for --env-name / --sdk-version', () => {
    expect(translateToPwsh(['--env-name', 'foo'])).toEqual(['-EnvName', 'foo']);
    expect(translateToPwsh(['--sdk-version', '1.0.1'])).toEqual(['-SdkVersion', '1.0.1']);
  });

  it('passes unknown flags through verbatim', () => {
    expect(translateToPwsh(['--verbose', 'positional'])).toEqual(['--verbose', 'positional']);
  });
});

describe('install.mjs end-to-end delegation', () => {
  it('invokes the host installer and surfaces its [plan] in dry-run', () => {
    const r = spawnSync('node', ['install.mjs', '--dry-run'], {
      encoding: 'utf8',
      cwd: pkgDir,
    });
    expect(r.status, `node install.mjs --dry-run failed: ${r.stderr ?? ''}`).toBe(0);
    expect(r.stdout).toContain('[plan] typeCAD Zephyr installer');
    expect(r.stdout).toContain('sdk version:       0.17.4');
    expect(r.stdout).toContain('[plan] DRY-RUN');
  });

  it('forwards overrides through the dispatcher to the native script', () => {
    const r = spawnSync(
      'node',
      ['install.mjs', '--dry-run', '--env-name', 'disp', '--sdk-version', '1.0.1'],
      { encoding: 'utf8', cwd: pkgDir },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('env name:          disp');
    expect(r.stdout).toContain('sdk version:       1.0.1');
  });
});
