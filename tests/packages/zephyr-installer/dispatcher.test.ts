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
import {
  translateToPwsh,
  buildSummary,
  detectPlatform,
  loadVersionsEnv,
} from '../../../packages/zephyr-installer/install.mjs';

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

  it('consumes --yes / -y so they are not forwarded to the native script', () => {
    // If --yes were forwarded, install.sh would reject it as an unknown flag
    // (exit 2, no [plan]). A clean [plan] on dry-run proves it was stripped.
    for (const flag of ['--yes', '-y']) {
      const r = spawnSync('node', ['install.mjs', flag, '--dry-run'], {
        encoding: 'utf8',
        cwd: pkgDir,
      });
      expect(r.status, `--dry-run with ${flag} should exit 0`).toBe(0);
      expect(r.stdout).toContain('[plan] typeCAD Zephyr installer');
    }
  });
});

describe('install.mjs confirmation-gate helpers', () => {
  it('detectPlatform returns mamba/sdk/ext tokens for the host', () => {
    const p = detectPlatform();
    expect(p.mamba).toBeTruthy();
    expect(p.sdk).toBeTruthy();
    expect(p.ext).toMatch(/^(tar\.xz|7z)$/);
    if (process.platform === 'win32') {
      expect(p).toEqual({ mamba: 'win-64', sdk: 'windows-x86_64', ext: '7z' });
    }
  });

  it('buildSummary surfaces the SDK version, bundle name, env name, and default locations', () => {
    const v = loadVersionsEnv();
    const p = detectPlatform();
    const summary = buildSummary(v, p, 'zephyr');
    expect(summary).toContain('typeCAD Zephyr installer');
    expect(summary).toContain(v.ZEPHYR_SDK_VERSION);
    expect(summary).toContain(`zephyr-sdk-${v.ZEPHYR_SDK_VERSION}_${p.sdk}.${p.ext}`);
    expect(summary).toContain("'zephyr'");
    expect(summary).toContain('west init');
    expect(summary).toContain('ZEPHYR_SDK_INSTALL_DIR');
    expect(summary).toMatch(/micromamba/);
  });
});
