import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dispatcher (install.mjs) is the universal entry point: `node install.mjs`
// delegates to install.sh (POSIX) or install.ps1 (Windows). This test covers
// both the flag translation (which runs on Windows only — unit-tested here on
// any host by importing the function) and the end-to-end delegation (run the
// dispatcher in dry-run and assert the native script's [plan] comes through).
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/framework-zephyr/installer');

// Importing install.mjs must NOT trigger a dispatch (the isMain guard).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs has no type decl; we only use it as a plain function.
import {
  translateToPwsh,
  buildSummary,
  buildHelp,
  buildDeleteSummary,
  detectPlatform,
  loadVersionsEnv,
  platformCatalog,
  parsePlatformSelection,
  buildChecklist,
} from '../../../../packages/framework-zephyr/installer/install.mjs';

describe('install.mjs flag translation (POSIX → PowerShell)', () => {
  it('maps each documented flag to its PowerShell param name', () => {
    expect(translateToPwsh(['--dry-run'])).toEqual(['-DryRun']);
    expect(translateToPwsh(['--no-sdk'])).toEqual(['-NoSdk']);
    expect(translateToPwsh(['--no-workspace'])).toEqual(['-NoWorkspace']);
    expect(translateToPwsh(['--modify'])).toEqual(['-Modify']);
  });

  it('consumes the value for --env-name / --sdk-version / --platforms', () => {
    expect(translateToPwsh(['--env-name', 'foo'])).toEqual(['-EnvName', 'foo']);
    expect(translateToPwsh(['--sdk-version', '1.0.1'])).toEqual(['-SdkVersion', '1.0.1']);
    expect(translateToPwsh(['--platforms', 'arm,esp32'])).toEqual(['-Platforms', 'arm,esp32']);
  });

  it('passes unknown flags through verbatim', () => {
    expect(translateToPwsh(['--verbose', 'positional'])).toEqual(['--verbose', 'positional']);
  });
});

describe('install.mjs platform selection', () => {
  const catalog = platformCatalog();

  it('builds a catalog from versions.env with ids, labels, sizes, toolchains', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(4);
    const ids = catalog.map((g) => g.id);
    expect(ids).toContain('arm');
    expect(ids).toContain('esp32');
    for (const g of catalog) {
      expect(g.label).toBeTruthy();
      expect(g.toolchains.length).toBeGreaterThan(0);
    }
  });

  it('parses numeric, named, comma-separated, and "all" selections', () => {
    expect(parsePlatformSelection('1 2', catalog)).toBe('arm,esp32');
    expect(parsePlatformSelection('1,2', catalog)).toBe('arm,esp32');
    expect(parsePlatformSelection('arm,esp32', catalog)).toBe('arm,esp32');
    expect(parsePlatformSelection('all')).toBe('all');
    expect(parsePlatformSelection('a')).toBe('all');
    expect(parsePlatformSelection('')).toBe('all');
  });

  it('rejects out-of-range numbers and unknown names', () => {
    expect(() => parsePlatformSelection('99', catalog)).toThrow(/invalid platform number/);
    expect(() => parsePlatformSelection('bogus', catalog)).toThrow(/unknown platform/);
  });

  it('renders the checklist with installed markers', () => {
    const text = buildChecklist(catalog, ['arm-zephyr-eabi']);
    expect(text).toContain('ARM Cortex-M');
    expect(text).toContain('ESP32');
    expect(text).toContain('installed');
    expect(text).toContain('[a] All');
    // Groups not installed don't get the 'installed' tag on their line.
    const esp32Line = text.split('\n').find((l) => l.includes('ESP32'))!;
    expect(esp32Line).not.toContain('installed');
  });

  it('buildSummary reflects the platform selection (all vs selective)', () => {
    const v = loadVersionsEnv();
    const p = detectPlatform();
    const all = buildSummary(v, p, 'zephyr', 'all');
    expect(all).toContain('~1.5 GB');
    const sel = buildSummary(v, p, 'zephyr', 'arm,esp32');
    expect(sel).toContain('arm,esp32');
    expect(sel).not.toContain('~1.5 GB download, ~11 GB extracted');
  });

  it('buildHelp documents every flag, the platform groups, and examples', () => {
    const help = buildHelp();
    // Flags the dispatcher itself consumes or forwards.
    expect(help).toContain('--platforms');
    expect(help).toContain('--modify');
    expect(help).toContain('--yes');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--no-sdk');
    expect(help).toContain('--no-workspace');
    expect(help).toContain('--env-name');
    expect(help).toContain('--sdk-version');
    expect(help).toContain('--help');
    // Platform groups from the catalog are listed with sizes.
    expect(help).toContain('ARM Cortex-M');
    expect(help).toContain('~150 MB');
    expect(help).toContain('ESP32');
    // Examples show the primary npx form.
    expect(help).toContain('npx --package @typecad/framework-zephyr zephyr-installer');
    expect(help).toContain('--platforms arm,esp32');
  });

  it('--help / -h prints help and exits 0 before any dispatch', () => {
    for (const flag of ['--help', '-h']) {
      const r = spawnSync('node', ['install.mjs', flag], { encoding: 'utf8', cwd: pkgDir });
      expect(r.status, `install.mjs ${flag} should exit 0`).toBe(0);
      expect(r.stdout).toContain('Platform groups');
      expect(r.stdout).toContain('Usage:');
      // Help must not trigger a dispatch (no [plan] output from a native script).
      expect(r.stdout).not.toContain('[plan]');
    }
  });

  it('buildDeleteSummary lists every install path and requires a typed yes', () => {
    // Pass hermetic temp paths so the summary's on-disk size walk never stats
    // the real (multi-GB) SDK/workspace installs — the same isolation the
    // subprocess --delete tests below enforce via MAMBA_ROOT_PREFIX/WORKSPACE_DIR.
    const tmp = mkdtempSync(join(tmpdir(), 'tc-del-summary-'));
    try {
      const paths = {
        mambaRoot: join(tmp, 'mm'),
        env: join(tmp, 'mm', 'envs', 'zephyr'),
        sdkParent: join(tmp, 'mm', 'zephyr-sdk'),
        workspace: join(tmp, 'ws'),
      };
      const summary = buildDeleteSummary(paths);
      expect(summary).toContain('conda env');
      expect(summary).toContain(paths.env.split('\\').pop()! || paths.env);
      expect(summary).toContain('Zephyr SDK');
      expect(summary).toContain('west workspace');
      expect(summary).toContain("Type 'yes' to DELETE");
      // The shell-profile hook is explicitly noted as NOT auto-edited.
      expect(summary).toContain('NOT edited automatically');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--delete without --yes on non-interactive stdin aborts (destructive default-deny)', () => {
    // Point at temp paths so the size walk doesn't stat the real multi-GB SDK.
    const tmp = spawnSync('node', ['-e', 'console.log(require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/tc-del2-"))'], { encoding: 'utf8' });
    const tmpDir = tmp.stdout.trim();
    const r = spawnSync(
      'node',
      ['install.mjs', '--delete'],
      {
        encoding: 'utf8',
        cwd: pkgDir,
        input: 'yes\n', // piped answer must NOT count: no TTY → refuse
        env: { ...process.env, MAMBA_ROOT_PREFIX: `${tmpDir}/mm`, WORKSPACE_DIR: `${tmpDir}/ws` },
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Re-run with --yes');
    // Crucially: nothing was deleted (no per-item 'deleted' result lines).
    expect(r.stdout).not.toMatch(/\n {2}deleted {2}/);
    spawnSync('node', ['-e', `require("node:fs").rmSync("${tmpDir.replace(/\\/g, '/')}", {recursive:true, force:true})`]);
  });

  it('--delete on a non-existent install reports not-present and exits 0 with --yes', () => {
    // Point at an empty temp prefix so the real install is never at risk.
    const tmp = spawnSync('node', ['-e', 'console.log(require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/tc-del-"))'], { encoding: 'utf8' });
    const tmpDir = tmp.stdout.trim();
    const r = spawnSync(
      'node',
      ['install.mjs', '--delete', '--yes'],
      { encoding: 'utf8', cwd: pkgDir, env: { ...process.env, MAMBA_ROOT_PREFIX: `${tmpDir}/mm`, WORKSPACE_DIR: `${tmpDir}/ws` } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('not present');
    expect(r.stdout).toContain('Uninstall complete');
    spawnSync('node', ['-e', `require("node:fs").rmSync("${tmpDir.replace(/\\/g, '/')}", {recursive:true, force:true})`]);
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
    expect(r.stdout).toContain('sdk version:       1.0.1');
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
    expect(summary).toContain(`zephyr-sdk-${v.ZEPHYR_SDK_VERSION}_${p.sdk}${v.ZEPHYR_SDK_BUNDLE_SUFFIX ?? ''}.${p.ext}`);
    expect(summary).toContain("'zephyr'");
    expect(summary).toContain('west init');
    expect(summary).toContain('ZEPHYR_SDK_INSTALL_DIR');
    expect(summary).toMatch(/micromamba/);
  });
});
