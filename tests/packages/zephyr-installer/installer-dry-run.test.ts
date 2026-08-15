import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Drives install.sh --dry-run end-to-end without touching the network or the
// filesystem. This is the closest a unit test can get to validating the
// installer: it asserts platform detection, URL construction, and path
// resolution all agree with versions.env for the *current* host. A full
// install + `west build` smoke run lives in the (out-of-scope) CI matrix.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/zephyr-installer');

function bashAvailable(): boolean {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function runDryRun(): string {
  const r = spawnSync('bash', ['install.sh', '--dry-run'], {
    encoding: 'utf8',
    cwd: pkgDir,
  });
  expect(r.status, `install.sh --dry-run exited non-zero: ${r.stderr ?? ''}`).toBe(0);
  expect(r.stdout, 'install.sh --dry-run produced no output').toBeTruthy();
  return r.stdout;
}

// Skip the whole group when bash isn't on PATH (e.g. a pristine Windows CI
// runner without Git Bash) instead of failing the suite.
const itBash = bashAvailable() ? it : it.skip;

describe('zephyr-installer install.sh --dry-run', () => {
  itBash('emits a [plan] block with the pinned versions', () => {
    const out = runDryRun();
    expect(out).toContain('[plan] typeCAD Zephyr installer');
    expect(out).toContain('sdk version:       1.0.1');
    expect(out).toContain('env name:          zephyr');
    expect(out).toContain('manifest rev:      v4.4.2');
    expect(out).toContain('[plan] DRY-RUN');
  });

  itBash('resolves the host platform to the correct bundle + conda subdir', () => {
    const out = runDryRun();
    // Map node's view of the host to the tokens install.sh should emit.
    let sdkPlat: string, ext: string, mambaPlat: string;
    if (process.platform === 'win32') {
      sdkPlat = 'windows-x86_64';
      ext = '7z';
      mambaPlat = 'win-64';
    } else if (process.platform === 'darwin') {
      const arm = process.arch === 'arm64';
      sdkPlat = arm ? 'macos-aarch64' : 'macos-x86_64';
      ext = 'tar.xz';
      mambaPlat = arm ? 'osx-arm64' : 'osx-64';
    } else {
      const arm = process.arch === 'arm64';
      sdkPlat = arm ? 'linux-aarch64' : 'linux-x86_64';
      ext = 'tar.xz';
      mambaPlat = arm ? 'linux-aarch64' : 'linux-64';
    }
    expect(out).toContain(`conda subdir:      ${mambaPlat}`);
    expect(out).toContain(`sdk platform:      ${sdkPlat}`);
    // 1.0.x bundle names carry the _gnu flavor suffix.
    expect(out).toContain(`zephyr-sdk-1.0.1_${sdkPlat}_gnu.${ext}`);
    expect(out).toContain(`micromamba url:    https://micro.mamba.pm/api/micromamba/${mambaPlat}/latest`);
  });

  itBash('points the SDK bundle at the pinned sdk-ng release', () => {
    const out = runDryRun();
    expect(out).toContain(
      'sdk bundle url:    https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v1.0.1/',
    );
  });

  itBash('resolves ZEPHYR_BASE and the SDK install dir', () => {
    const out = runDryRun();
    expect(out).toMatch(/zephyr base:\s+\S*zephyrproject\/?zephyr/);
    expect(out).toMatch(/sdk install dir:\s+\S*zephyr-sdk-1\.0\.1/);
    expect(out).toMatch(/env prefix:\s+\S*envs\/zephyr/);
  });

  itBash('honors --env-name and --sdk-version overrides', () => {
    const r = spawnSync(
      'bash',
      ['install.sh', '--dry-run', '--env-name', 'myzephyr', '--sdk-version', '1.0.1'],
      { encoding: 'utf8', cwd: pkgDir },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('env name:          myzephyr');
    expect(r.stdout).toContain('sdk version:       1.0.1');
    // The override also changes the constructed bundle name.
    expect(r.stdout).toMatch(/zephyr-sdk-1\.0\.1_/);
  });

  itBash('reflects --no-sdk / --no-workspace in the plan', () => {
    const r = spawnSync(
      'bash',
      ['install.sh', '--dry-run', '--no-sdk', '--no-workspace'],
      { encoding: 'utf8', cwd: pkgDir },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('do sdk:            0');
    expect(r.stdout).toContain('do workspace:      0');
  });
});
