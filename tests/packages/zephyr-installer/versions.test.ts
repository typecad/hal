import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// versions.env is the single source of pinning for the installer. This test
// guards its structure (not network reachability — that belongs to the
// cross-platform smoke test, which is intentionally out of the unit suite).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const versionsPath = join(repoRoot, 'packages/zephyr-installer/versions.env');

function parseEnv(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return vars;
}

describe('zephyr-installer versions.env', () => {
  const v = parseEnv(versionsPath);

  it('pins a Zephyr SDK version', () => {
    expect(v.ZEPHYR_SDK_VERSION).toBeTruthy();
    expect(v.ZEPHYR_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('pins the vanilla Zephyr manifest URL and a tag revision', () => {
    expect(v.ZEPHYR_MANIFEST_URL).toBe('https://github.com/zephyrproject-rtos/zephyr.git');
    expect(v.ZEPHYR_MANIFEST_REV).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('uses the official sdk-ng release base', () => {
    expect(v.SDK_RELEASE_BASE).toContain('zephyrproject-rtos/sdk-ng/releases/download');
  });

  it('uses the micro.mamba.pm micromamba API base', () => {
    expect(v.MICROMAMBA_BASE).toBe('https://micro.mamba.pm/api/micromamba');
  });

  it('declares a conda env name', () => {
    expect(v.ENV_NAME).toBeTruthy();
    expect(v.ENV_NAME).toBe('zephyr');
  });

  it('declares a SHA256 slot (or TODO) for every supported SDK platform', () => {
    const platforms = [
      'linux_x86_64',
      'linux_aarch64',
      'macos_x86_64',
      'macos_aarch64',
      'windows_x86_64',
    ];
    for (const p of platforms) {
      const key = `SHA256_${p}`;
      expect(v[key], `missing ${key} in versions.env`).toBeTruthy();
      // Either the literal TODO placeholder or a pinned 64-hex sha256.
      expect(v[key] === 'TODO' || /^[0-9a-f]{64}$/.test(v[key])).toBe(true);
    }
  });

  it('pins SHA256 for platforms already exercised by a real install', () => {
    // linux-x86_64 + windows-x86_64 were computed by the installer against the
    // official SDK bundle and pinned, so verification is enforced (not warned).
    // Hardcoded so a typo or accidental TODO-reset in versions.env is caught.
    expect(v.SHA256_linux_x86_64).toBe(
      '83f2f327dba2d6cf2440f22f2f501041544d7f34ef8b878ecd83f4513d1116b6',
    );
    expect(v.SHA256_windows_x86_64).toBe(
      '51d550eb2c22c1679b9ac1116e2f5c45376b0d36f1bfcf2a1f1cea29d9384ecd',
    );
  });

  it('constructs a well-formed bundle URL for each platform', () => {
    const extByPlat: Record<string, string> = {
      'linux-x86_64': 'tar.xz',
      'linux-aarch64': 'tar.xz',
      'macos-x86_64': 'tar.xz',
      'macos-aarch64': 'tar.xz',
      'windows-x86_64': '7z',
    };
    for (const [plat, ext] of Object.entries(extByPlat)) {
      const bundle = `zephyr-sdk-${v.ZEPHYR_SDK_VERSION}_${plat}.${ext}`;
      const url = `${v.SDK_RELEASE_BASE}/v${v.ZEPHYR_SDK_VERSION}/${bundle}`;
      expect(url).toMatch(
        /^https:\/\/github\.com\/zephyrproject-rtos\/sdk-ng\/releases\/download\/v[\d.]+\/zephyr-sdk-[\d.]+_[a-z0-9_-]+\.(tar\.xz|7z)$/,
      );
    }
  });
});

describe('zephyr-installer install scripts', () => {
  const installerDir = join(repoRoot, 'packages/zephyr-installer');

  it('install Zephyr Python build requirements (jsonschema, pykwalify, ...) after west update', () => {
    // Without this, `west build` fails at CMake configure with
    // "Missing jsonschema dependency". Both native installers must wire it.
    const initSh = readFileSync(join(installerDir, 'lib/init-workspace.sh'), 'utf8');
    const installPs1 = readFileSync(join(installerDir, 'install.ps1'), 'utf8');
    expect(initSh).toContain('requirements-base.txt');
    expect(initSh).toContain('pip install -r');
    expect(installPs1).toContain('requirements-base.txt');
    expect(installPs1).toContain('pip install -r');
  });
});
