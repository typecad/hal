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
    let val = line.slice(idx + 1).trim();
    // Strip optional surrounding double quotes (multi-word PLATFORM_* values).
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    vars[line.slice(0, idx).trim()] = val;
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

  it('declares a SHA256 slot (or TODO/NONE) for every supported SDK platform', () => {
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
      // TODO = unpinned; NONE = no build exists for that platform; else 64-hex.
      expect(v[key] === 'TODO' || v[key] === 'NONE' || /^[0-9a-f]{64}$/.test(v[key])).toBe(true);
    }
  });

  it('pins SHA256 (from the release sha256.sum) for every 1.0.x platform', () => {
    // Hardcoded so a typo or accidental TODO-reset in versions.env is caught.
    // Source: https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v1.0.1/sha256.sum
    expect(v.SHA256_linux_x86_64).toBe(
      '37a8c5b5569c2b482d39099c65fe3ddac4e43524996c731907e1e9f5818cbba7',
    );
    expect(v.SHA256_linux_aarch64).toBe(
      '6e38018f70af5e90c18cc04c2f8ac5a91c99f5559b25692d1b0de328c3edb88a',
    );
    expect(v.SHA256_macos_aarch64).toBe(
      '3dc6346a5888ebbcee19801bf6271627f04819778fe0ef3c7f3c7528e8f4ef2a',
    );
    expect(v.SHA256_windows_x86_64).toBe(
      '811cb97797ddf6198eea66b030168d12512f605c7e332ea24d2cbe47b769c472',
    );
    // macOS Intel has no 1.0.x build — the explicit NONE sentinel (fetch fails
    // with guidance rather than 404-ing mid-download).
    expect(v.SHA256_macos_x86_64).toBe('NONE');
  });

  it('declares the 1.0.x bundle flavor suffix so bundle URLs resolve', () => {
    // 1.0.x dropped "full" bundles; _gnu = all GNU toolchains + host tools.
    // Individual toolchain tarballs carry the flavor as an infix
    // (toolchain_gnu_<plat>_<target>). Both native scripts + the JS summary
    // must append it or every download 404s.
    expect(v.ZEPHYR_SDK_BUNDLE_SUFFIX).toBe('_gnu');
    const fetchSdk = readFileSync(join(repoRoot, 'packages/zephyr-installer/lib/fetch-sdk.sh'), 'utf8');
    expect(fetchSdk).toContain('ZEPHYR_SDK_BUNDLE_SUFFIX');
    expect(fetchSdk).toContain('toolchain_${tc_infix}');
    const installPs1 = readFileSync(join(repoRoot, 'packages/zephyr-installer/install.ps1'), 'utf8');
    expect(installPs1).toContain('$SdkSuffix');
    expect(installPs1).toContain('toolchain_$TcInfix');
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
      const bundle = `zephyr-sdk-${v.ZEPHYR_SDK_VERSION}_${plat}${v.ZEPHYR_SDK_BUNDLE_SUFFIX ?? ''}.${ext}`;
      const url = `${v.SDK_RELEASE_BASE}/v${v.ZEPHYR_SDK_VERSION}/${bundle}`;
      expect(url).toMatch(
        /^https:\/\/github\.com\/zephyrproject-rtos\/sdk-ng\/releases\/download\/v[\d.]+\/zephyr-sdk-[\d.]+_[a-z0-9_-]+(_gnu)?\.(tar\.xz|7z)$/,
      );
    }
  });
});

describe('zephyr-installer install scripts', () => {
  const installerDir = join(repoRoot, 'packages/zephyr-installer');
  const v = parseEnv(versionsPath);

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

  it('environment.yml pins cmake <4 (Zephyr 4.3.x is incompatible with CMake 4.x)', () => {
    const env = readFileSync(join(installerDir, 'environment.yml'), 'utf8');
    const cmakeLine = env.split(/\r?\n/).find((l) => l.trim().startsWith('- cmake'));
    expect(cmakeLine, 'environment.yml must declare a cmake dependency').toBeTruthy();
    // CMake 4.x rejects an unquoted ${VAR} in an if() that Zephyr 4.3.x uses
    // (FindZephyr-sdk.cmake:57); CMake 3.x handles the empty expansion. Conda
    // must resolve a 3.x — without the upper bound it pulls 4.4.x and builds fail.
    expect(cmakeLine).toMatch(/<\s*4/);
    expect(cmakeLine).toMatch(/>=\s*3\.20/);
  });

  it('environment.yml installs ccache (Zephyr auto-routes compiles/links through it)', () => {
    // Zephyr's cmake/modules/ccache.cmake wires RULE_LAUNCH_COMPILE/_LINK to
    // ccache whenever it is on PATH, so env-installed ccache makes fresh build
    // dirs (config/board changes) replay from cache instead of recompiling
    // every unchanged Zephyr library object.
    const env = readFileSync(join(installerDir, 'environment.yml'), 'utf8');
    expect(env).toMatch(/^\s*-\s*ccache\s*$/m);
  });

  it('install per-module requirements.txt (esptool for ESP32, etc.) — build-relevant locations only', () => {
    // Without this, board-specific build steps fall back to system tools (e.g. an
    // old esptool) and fail. Target HAL scripts/zephyr + lib codegen, NOT a
    // recursive find that would also pull docs/test/harness/example requirements.
    const initSh = readFileSync(join(installerDir, 'lib/init-workspace.sh'), 'utf8');
    const installPs1 = readFileSync(join(installerDir, 'install.ps1'), 'utf8');
    expect(initSh).toContain('modules/hal/');
    expect(initSh).toContain('requirements.txt');
    expect(installPs1).toContain('modules/hal/');
    expect(installPs1).toContain('requirements.txt');
  });

  it('declares platform groups with toolchains, labels, and sizes (selective install)', () => {
    // Each PLATFORM_<id> must have matching _LABEL and _SIZE entries, and at
    // least one valid toolchain target. Values are quoted (shell-sourceable).
    const groups = Object.keys(v)
      .map((k) => k.match(/^PLATFORM_([a-z0-9]+)$/)?.[1])
      .filter(Boolean) as string[];
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (const id of groups) {
      expect(v[`PLATFORM_${id}`], `PLATFORM_${id} must list toolchains`).toBeTruthy();
      expect(v[`PLATFORM_${id}_LABEL`], `missing LABEL for ${id}`).toBeTruthy();
      expect(v[`PLATFORM_${id}_SIZE`], `missing SIZE for ${id}`).toBeTruthy();
      // Toolchain targets end in -zephyr-eabi or -zephyr-elf (xtensa variants
      // have a longer prefix like xtensa-espressif_esp32_zephyr-elf).
      const targets = v[`PLATFORM_${id}`]!.split(/\s+/);
      for (const t of targets) {
        expect(t).toMatch(/[-_]zephyr-(eabi|elf)$/);
      }
    }
  });

  it('arm and esp32 groups are present with the expected toolchains', () => {
    // The two most common groups; guard against accidental removal/renaming.
    expect(v.PLATFORM_arm).toBe('arm-zephyr-eabi');
    expect(v.PLATFORM_esp32).toContain('xtensa-espressif_esp32s3_zephyr-elf');
  });

  it('both native installers parse --platforms and support selective SDK mode', () => {
    const installSh = readFileSync(join(installerDir, 'install.sh'), 'utf8');
    const installPs1 = readFileSync(join(installerDir, 'install.ps1'), 'utf8');
    const fetchSdk = readFileSync(join(installerDir, 'lib/fetch-sdk.sh'), 'utf8');
    expect(installSh).toContain('--platforms');
    expect(installSh).toContain('PLATFORMS');
    expect(installPs1).toContain('[string]$Platforms');
    expect(installPs1).toContain('minimal');
    expect(fetchSdk).toContain('minimal');
    // Idempotency per-toolchain (so --modify can add without re-downloading all).
    expect(fetchSdk).toContain('.typecad-platforms');
    expect(installPs1).toContain('.typecad-platforms');
  });
});
