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
      case '--modify':       out.push('-Modify'); break;
      case '--env-name':     out.push('-EnvName', args[++i]); break;
      case '--sdk-version':  out.push('-SdkVersion', args[++i]); break;
      case '--platforms':    out.push('-Platforms', args[++i]); break;
      default:               out.push(args[i]);
    }
  }
  return out;
}

// --- confirmation-gate helpers ---------------------------------------------

// Parse versions.env (KEY=value, # comments) into an object. Strips optional
// double quotes around values (needed for multi-word values like PLATFORM_esp32).
export function loadVersionsEnv(dir = here) {
  const v = {};
  const text = readFileSync(join(dir, 'versions.env'), 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx > 0) {
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
      v[line.slice(0, idx).trim()] = val;
    }
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
// without running the installer. `platforms` is the selection string ('all' or
// comma-separated group ids) used to size the SDK download line.
export function buildSummary(v, p, envName, platforms = 'all') {
  const home = homedir();
  const mambaRoot = process.env.MAMBA_ROOT_PREFIX || join(home, 'micromamba');
  const workspace = process.env.WORKSPACE_DIR || join(home, 'zephyrproject');
  const sdkVer = v.ZEPHYR_SDK_VERSION || '<pinned>';
  const rev = v.ZEPHYR_MANIFEST_REV || '<pinned>';
  const bundle = `zephyr-sdk-${sdkVer}_${p.sdk}.${p.ext}`;
  const sdkLine = platforms === 'all'
    ? `  3. Fetch + extract the Zephyr SDK ${sdkVer} — ${bundle} (~1.5 GB download, ~11 GB extracted).`
    : `  3. Fetch + extract the Zephyr SDK ${sdkVer} (minimal + selected toolchains — platforms: ${platforms}).`;
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
    sdkLine,
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

// --- platform checklist ------------------------------------------------------

// The platform groups from versions.env (PLATFORM_<id>, PLATFORM_<id>_LABEL,
// PLATFORM_<id>_SIZE). Returns [{id, label, size, toolchains}].
export function platformCatalog(v = loadVersionsEnv()) {
  const groups = [];
  for (const key of Object.keys(v)) {
    const m = key.match(/^PLATFORM_([a-z0-9]+)$/);
    if (!m) continue;
    const id = m[1];
    groups.push({
      id,
      label: v[`PLATFORM_${id}_LABEL`] || id,
      size: v[`PLATFORM_${id}_SIZE`] || '',
      toolchains: (v[key] || '').split(/\s+/).filter(Boolean),
    });
  }
  return groups;
}

// Parse the user's checklist answer ('1 2', '1,2', 'all', 'arm esp32') into a
// normalized comma-separated group-id string ('arm,esp32') or 'all'.
// Numbers index into catalog (1-based); names must match group ids.
export function parsePlatformSelection(answer, catalog = platformCatalog()) {
  const trimmed = (answer || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === 'a') return 'all';
  const picked = new Set();
  for (const tok of trimmed.split(/[\s,]+/).filter(Boolean)) {
    if (/^\d+$/.test(tok)) {
      const idx = Number(tok) - 1;
      if (idx >= 0 && idx < catalog.length) picked.add(catalog[idx].id);
      else throw new Error(`invalid platform number: ${tok} (choose 1-${catalog.length} or 'all')`);
    } else {
      const grp = catalog.find((g) => g.id === tok);
      if (!grp) throw new Error(`unknown platform: ${tok} (choose a number, a group id, or 'all')`);
      picked.add(grp.id);
    }
  }
  if (picked.size === 0) return 'all';
  return [...picked].join(',');
}

// Render the checklist text. `installedToolchains` (array of toolchain target
// dir names found under the SDK root) marks groups already installed.
export function buildChecklist(catalog = platformCatalog(), installedToolchains = []) {
  const inst = new Set(installedToolchains);
  const lines = ['', 'Select platform toolchains to install:', ''];
  catalog.forEach((g, i) => {
    const allIn = g.toolchains.length > 0 && g.toolchains.every((t) => inst.has(t));
    const someIn = g.toolchains.some((t) => inst.has(t));
    const mark = allIn ? '[x]' : someIn ? '[~]' : '[ ]';
    const instTag = allIn ? '  installed' : someIn ? '  partial' : '';
    const size = g.size ? `  ${g.size}` : '';
    lines.push(`  [${i + 1}] ${g.label.padEnd(48)}${size}${instTag}`);
  });
  lines.push('  [a] All (full bundle, ~1.5 GB download / ~11 GB extracted)');
  lines.push('');
  lines.push("Enter selection (e.g. '1 2', 'arm,esp32', or 'all'): ");
  return lines.join('\n');
}

// Interactive checklist: print, read one line, parse. Returns the normalized
// selection string ('all' or comma-separated group ids).
export async function platformChecklist(installedToolchains = []) {
  const catalog = platformCatalog();
  output.write(buildChecklist(catalog, installedToolchains));
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('');
    return parsePlatformSelection(answer, catalog);
  } finally {
    rl.close();
  }
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

// Render the --help text. Shows flags, platform groups, and examples.
// Exported so tests can assert on the content.
export function buildHelp(v = loadVersionsEnv()) {
  const catalog = platformCatalog(v);
  const groups = catalog
    .map((g, i) => `  ${String(i + 1).padStart(2)}. ${g.label.padEnd(48)} ${g.size}`)
    .join('\n');
  return `
typeCAD Zephyr installer — cross-platform Zephyr toolchain setup via micromamba.

Usage:
  npx @typecad/zephyr-installer [flags]

Installs: micromamba + conda env (west, cmake, ninja, dtc, gperf) + the Zephyr
SDK (selective toolchains or full bundle) + a vanilla west workspace
(${v.ZEPHYR_MANIFEST_URL || 'zephyr.git'} @ ${v.ZEPHYR_MANIFEST_REV || 'pinned'}).

Platform groups (interactive checklist, or --platforms <ids>):
${groups}
  all. Full bundle (~1.5 GB download, ~11 GB extracted)

Flags:
  (none)            Interactive: platform checklist → summary → Enter → install.
  --platforms IDS   Non-interactive: comma-separated group ids or 'all'.
  --modify          Re-present the checklist on an existing install to
                    add/remove platforms. Deselected toolchains are DELETED
                    from disk. SDK-only (skips env/workspace).
  --yes, -y         Skip the confirmation prompt (CI / scripting).
  --dry-run         Print the resolved plan (URLs, paths, versions) and exit.
  --no-sdk          Skip the Zephyr SDK download (env + workspace only).
  --no-workspace    Skip west init/update (env + SDK only).
  --env-name NAME   Override the conda env name (default: ${v.ENV_NAME || 'zephyr'}).
  --sdk-version V   Override the Zephyr SDK version (default: ${v.ZEPHYR_SDK_VERSION || 'pinned'}).
  -h, --help        Show this help.

Environment overrides:
  MAMBA_ROOT_PREFIX   micromamba root (default: ~/micromamba)
  WORKSPACE_DIR       west workspace (default: ~/zephyrproject)
  SDK_INSTALL_PARENT  where the SDK extracts (default: $MAMBA_ROOT_PREFIX/zephyr-sdk)

Examples:
  npx @typecad/zephyr-installer                       # interactive (checklist)
  npx @typecad/zephyr-installer --platforms arm       # ARM Cortex-M only (~150 MB)
  npx @typecad/zephyr-installer --platforms arm,esp32 # ARM + ESP32 (~450 MB)
  npx @typecad/zephyr-installer --platforms all       # full bundle (~1.5 GB)
  npx @typecad/zephyr-installer --modify              # add/remove platforms later
  npx @typecad/zephyr-installer --dry-run             # preview the plan
  node install.mjs --help                             # same, from a repo checkout
`.trimStart();
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
  // --help / -h: print + exit before any prompting or dispatch.
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    output.write(buildHelp());
    process.exit(0);
  }
  const dryRun = rawArgs.includes('--dry-run');
  const yes = rawArgs.includes('--yes') || rawArgs.includes('-y');
  const modify = rawArgs.includes('--modify') || rawArgs.includes('-m');
  // --platforms <sel> (non-interactive selection) — read + strip here so the
  // checklist doesn't prompt when it's given.
  let platforms = null;
  {
    const i = rawArgs.indexOf('--platforms');
    if (i >= 0 && i + 1 < rawArgs.length) platforms = rawArgs[i + 1];
  }
  // --yes / -y / --modify / -m / --platforms <v> are consumed here; everything
  // else (--dry-run, --no-sdk, --env-name, ...) is forwarded.
  const forwarded = rawArgs.filter(
    (a, i) =>
      a !== '--yes' && a !== '-y' && a !== '--modify' && a !== '-m' &&
      a !== '--platforms' && rawArgs[i - 1] !== '--platforms',
  );
  // Re-add the resolved platforms as a flag the native scripts understand.
  if (platforms) forwarded.push('--platforms', platforms);
  // --modify skips the env + workspace steps; only the SDK platform step runs.
  if (modify) forwarded.push('--no-workspace');

  (async () => {
    // --modify: warn before any destructive change (deselected toolchains are
    // deleted from disk). The user must acknowledge before the checklist runs.
    if (modify && !dryRun && !yes) {
      output.write(
        [
          '',
          'WARNING: --modify will DELETE the toolchain directories of any',
          'platform you deselect. Re-adding a removed platform later requires',
          're-downloading it (~100-300 MB per group).',
          '',
        ].join('\n'),
      );
      if (input.isTTY) {
        const rl = readline.createInterface({ input, output });
        try {
          await rl.question('Press Enter to continue (Ctrl+C to cancel): ');
        } finally {
          rl.close();
        }
      }
    }

    // Resolve the platform selection (interactive checklist unless given).
    if (platforms === null && !dryRun) {
      if (input.isTTY) {
        try {
          platforms = await platformChecklist([]);
        } catch (err) {
          console.error(`typecad-zephyr-install: ${err.message}`);
          process.exit(1);
        }
        // Replace any previously forwarded --platforms with the resolved value.
        const pi = forwarded.lastIndexOf('--platforms');
        if (pi >= 0) forwarded.splice(pi, 2);
        forwarded.push('--platforms', platforms);
      } else {
        // Non-interactive with no --platforms: default to 'all' (full bundle,
        // current behavior) so npx/CI invocations don't hang.
        platforms = 'all';
        forwarded.push('--platforms', 'all');
      }
    } else if (platforms === null) {
      // --dry-run without --platforms: forward without a selection; the native
      // dry-run prints both modes.
      platforms = 'all';
    }

    if (!dryRun) {
      output.write(buildSummary(loadVersionsEnv(), detectPlatform(), envNameFromArgs(rawArgs), platforms));
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
