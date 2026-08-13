#!/usr/bin/env node
// ---------------------------------------------------------------------------
// typeCAD Zephyr installer — cross-platform entry point.
//
// Run it:
//   npx @typecad/zephyr-installer            # interactive (prints a plan, waits for Enter)
//   npx @typecad/zephyr-installer --yes      # non-interactive (skip the prompt; for CI)
//   node install.mjs --dry-run               # print the resolved plan and exit
//
// It detects the host, prints a summary of what it will do, waits for Enter
// (unless --yes / --dry-run / non-TTY), then delegates to the native installer:
//
//   POSIX   →  bash install.sh   (args forwarded verbatim)
//   Windows →  pwsh install.ps1  (args translated to PowerShell param names;
//              falls back to Windows PowerShell 5.1 if pwsh is absent)
//
// The OS-native scripts remain usable directly (no confirmation gate) for
// power users. translateToPwsh + buildSummary are exported for unit tests; the
// dispatch + prompt only run when this file is the node entry point.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// Translate the user-facing POSIX-style flags into the PowerShell param names
// install.ps1 declares. Keeps the documented flag vocabulary identical across
// platforms; the OS-native scripts remain idiomatically written.
export function translateToPwsh(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':      out.push('-DryRun'); break;
      case '--no-sdk':       out.push('-NoSdk'); break;
      case '--no-workspace': out.push('-NoWorkspace'); break;
      case '--env-name':     out.push('-EnvName', args[++i]); break;
      case '--sdk-version':  out.push('-SdkVersion', args[++i]); break;
      default:               out.push(args[i]);
    }
  }
  return out;
}

// --- confirmation-gate helpers ---------------------------------------------

// Parse versions.env (KEY=value, # comments) into an object.
export function loadVersionsEnv(dir = here) {
  const v = {};
  const text = readFileSync(join(dir, 'versions.env'), 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx > 0) v[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return v;
}

// Map node's platform/arch to the conda subdir + Zephyr SDK bundle tokens that
// the native installer will use. Mirrors lib/detect-platform.sh.
export function detectPlatform() {
  const plat = process.platform;
  const arm = process.arch === 'arm64';
  if (plat === 'win32') return { mamba: 'win-64', sdk: 'windows-x86_64', ext: '7z' };
  if (plat === 'darwin') return arm
    ? { mamba: 'osx-arm64', sdk: 'macos-aarch64', ext: 'tar.xz' }
    : { mamba: 'osx-64', sdk: 'macos-x86_64', ext: 'tar.xz' };
  // linux
  return arm
    ? { mamba: 'linux-aarch64', sdk: 'linux-aarch64', ext: 'tar.xz' }
    : { mamba: 'linux-64', sdk: 'linux-x86_64', ext: 'tar.xz' };
}

// Pure: build the pre-install summary string. Exported so it's unit-testable
// without running the installer.
export function buildSummary(v, p, envName) {
  const home = homedir();
  const mambaRoot = process.env.MAMBA_ROOT_PREFIX || join(home, 'micromamba');
  const workspace = process.env.WORKSPACE_DIR || join(home, 'zephyrproject');
  const sdkVer = v.ZEPHYR_SDK_VERSION || '<pinned>';
  const rev = v.ZEPHYR_MANIFEST_REV || '<pinned>';
  const bundle = `zephyr-sdk-${sdkVer}_${p.sdk}.${p.ext}`;
  return [
    '',
    'typeCAD Zephyr installer',
    '========================',
    '',
    'This sets up a complete Zephyr RTOS build environment via micromamba — no',
    'preinstalled conda, Python, or toolchain required. It will:',
    '',
    `  1. Download the micromamba static binary (${p.mamba}).`,
    `  2. Create the '${envName}' conda env (west, cmake, ninja, gperf, ...).`,
    `  3. Fetch + extract the Zephyr SDK ${sdkVer} — ${bundle}`,
    '     (~1.5 GB download, ~11 GB extracted).',
    `  4. Run 'west init' (--mr ${rev}) + 'west update' for a vanilla Zephyr workspace.`,
    '',
    'Locations (defaults; override via MAMBA_ROOT_PREFIX / WORKSPACE_DIR / SDK_INSTALL_PARENT):',
    `  micromamba root : ${mambaRoot}`,
    `  conda env       : ${join(mambaRoot, 'envs', envName)}`,
    `  Zephyr SDK      : ${join(mambaRoot, 'zephyr-sdk', `zephyr-sdk-${sdkVer}`)}`,
    `  west workspace  : ${workspace}  (ZEPHYR_BASE = ${join(workspace, 'zephyr')})`,
    '',
    'No sudo, no Zephyr SDK setup.sh — the SDK is used in place via ZEPHYR_SDK_INSTALL_DIR.',
    '',
  ].join('\n');
}

// Read --env-name from argv (default 'zephyr') so the summary matches what the
// native installer will actually name the env.
function envNameFromArgs(args) {
  const i = args.indexOf('--env-name');
  return i >= 0 && i + 1 < args.length ? args[i + 1] : 'zephyr';
}

// Try each candidate executable in order; advance on ENOENT so the caller can
// express "prefer pwsh, fall back to powershell" without probing PATH itself.
function runWithFallback(exes, args) {
  return new Promise((resolve, reject) => {
    const tryOne = (idx) => {
      if (idx >= exes.length) {
        reject(new Error(`none found on PATH: ${exes.join(', ')}`));
        return;
      }
      const child = spawn(exes[idx], args, { stdio: 'inherit' });
      child.on('error', (err) => {
        if (err && err.code === 'ENOENT') tryOne(idx + 1);
        else reject(err);
      });
      child.on('exit', (code, signal) => resolve({ code, signal }));
    };
    tryOne(0);
  });
}

// Only dispatch when invoked directly as `node install.mjs` / via the bin, not
// when imported (the test suite imports translateToPwsh / buildSummary). Resolve
// symlinks on both sides: npx and global installs run the bin through a symlink,
// and path.resolve alone doesn't follow it — without realpathSync the guard
// evaluates false and the script exits without dispatching (npx "does nothing").
const realPath = (p) => { try { return realpathSync(p); } catch { return ''; } };
const invokedDirectly =
  !!process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1]);

if (invokedDirectly) {
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes('--dry-run');
  const yes = rawArgs.includes('--yes') || rawArgs.includes('-y');
  // --yes / -y are consumed here (the native scripts don't know them); everything
  // else (--dry-run, --no-sdk, --env-name, ...) is forwarded.
  const forwarded = rawArgs.filter((a) => a !== '--yes' && a !== '-y');

  (async () => {
    if (!dryRun) {
      output.write(buildSummary(loadVersionsEnv(), detectPlatform(), envNameFromArgs(rawArgs)));
      if (!yes) {
        if (input.isTTY) {
          const rl = readline.createInterface({ input, output });
          try {
            await rl.question('Press Enter to begin (Ctrl+C to cancel): ');
          } finally {
            rl.close();
          }
        } else {
          // Non-interactive stdin (some npx invocations, pipes, CI): can't
          // prompt, so proceed — the user invoked us explicitly. (--yes is the
          // explicit no-prompt flag.) Avoids `npx @typecad/...` aborting when
          // npx doesn't forward a TTY.
        }
      }
    }

    const promise = isWin
      ? runWithFallback(
          ['pwsh', 'powershell'],
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install.ps1'), ...translateToPwsh(forwarded)],
        )
      : runWithFallback(['bash'], [join(here, 'install.sh'), ...forwarded]);

    return promise
      .then(({ code, signal }) => {
        if (signal) process.exit(128);
        process.exit(code ?? 1);
      })
      .catch((err) => {
        console.error(`typecad-zephyr-install: ${err.message}`);
        if (isWin) {
          console.error('  Windows needs PowerShell, which ships with Windows 10+.');
          console.error('  If you have Git Bash, you can instead run: bash install.sh');
        } else {
          console.error('  POSIX hosts need bash. Install it, or on Windows use:');
          console.error('    pwsh -File install.ps1   (or powershell -File install.ps1)');
        }
        process.exit(1);
      });
  })();
}
