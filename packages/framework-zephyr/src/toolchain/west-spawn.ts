// ---------------------------------------------------------------------------
// west spawn helper — build a spawnSync invocation for `west <args>`
//
// Mirrors framework-esp32's idfSpawn(): given the discovered WestInstall,
// produce {command, args, env} that the toolchain destructures into spawnSync.
//
// Two modes:
//   - 'launcher': spawn the `west` launcher directly (mode 'launcher').
//   - 'module'  : spawn `<python> -m west ...` (mode 'module'). This is the
//                 robust cross-platform form — it activates the venv's
//                 interpreter for the one process without sourcing anything.
//
// ZEPHYR_BASE is injected into the spawn env when a SDK root was discovered
// (find_package(Zephyr) needs it). west's prj.conf/CMakeLists are found via
// the project dir regardless.
// ---------------------------------------------------------------------------

import type { SpawnSyncOptions } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { type WestInstall, discoverWest } from './west-discover.js';

export interface WestInvocation {
  /** The command to spawnSync: a `west` launcher or a Python interpreter. */
  command: string;
  /** Args for the command (includes `-m west` when in module mode). */
  args: string[];
  /** Base spawn options with cwd/timeout/encoding/stdio, plus the env carrying
   *  ZEPHYR_BASE when discovered. */
  options: SpawnSyncOptions;
  /** The install the invocation was built from, for surfacing to the user. */
  install: WestInstall;
}

/**
 * The Scripts/ (Windows) or bin/ (POSIX) directory of the venv the discovered
 * west runs under. `pythonExecutable` lives in that directory, so it is its
 * dirname. Returns undefined for launcher-mode installs where no venv is known.
 */
function venvBinDir(install: WestInstall): string | undefined {
  return install.pythonExecutable ? dirname(install.pythonExecutable) : undefined;
}

/**
 * The env to pass to the west spawn: the process env, with ZEPHYR_BASE injected
 * when a SDK root was discovered, AND the venv's bin/Scripts dir prepended to
 * PATH when west was found via a venv Python.
 *
 * The PATH prepend matters: `west flash` shells out to bare runner tools
 * (`esptool`, `openocd`, `nrfjprog`, …) via check_call, so they resolve from
 * PATH. Without the prepend, the user's PATH may surface a *different* tool
 * ahead of the venv's — e.g. an older esptool whose argument spelling is
 * incompatible with the runner. Putting the venv's bin first makes west's
 * delegated subprocesses resolve to the same versions west itself runs under.
 */
export function buildEnv(install: WestInstall): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (install.zephyrBase && !env.ZEPHYR_BASE) {
    env.ZEPHYR_BASE = install.zephyrBase;
  }
  // SWD flashing (`zephyr.runner: 'openocd'`): west's openocd runner resolves
  // a bare `openocd` from PATH. The Zephyr SDK ships it under
  // hosttools/openocd/bin (the SDK's own setup.cmd puts that dir on PATH for
  // activated terminals) — do the same for spawned west processes so ST-Link
  // flashing works without activation. $ZEPHYR_SDK_INSTALL_DIR (set by an
  // activated env) wins over the discovered install dir.
  const sdkRoot = env.ZEPHYR_SDK_INSTALL_DIR || install.sdkInstallDir;
  // Pin the west/cmake child to the discovered SDK: without this, Zephyr's
  // FindZephyr-sdk searches $HOME and can latch onto a stray, older SDK —
  // a configure-time version failure that only surfaces in the build log.
  if (!env.ZEPHYR_SDK_INSTALL_DIR && install.sdkInstallDir) {
    env.ZEPHYR_SDK_INSTALL_DIR = install.sdkInstallDir;
  }
  const openocdBin = sdkRoot ? join(sdkRoot, 'hosttools', 'openocd', 'bin') : undefined;
  const prepend = [
    openocdBin !== undefined && existsSync(openocdBin) ? openocdBin : undefined,
    venvBinDir(install),
  ].filter((d): d is string => d !== undefined);
  if (prepend.length > 0) {
    const sep = process.platform === 'win32' ? ';' : ':';
    // On Windows the PATH environment variable may be cased as `Path` (the
    // registry-native form, the only one populated when node is launched from
    // PowerShell/cmd) or `PATH` (POSIX form, set by Git Bash). Writing only one
    // casing can leave the other stale/empty, which under PowerShell would drop
    // the user's real PATH (cmake, ninja, …) — breaking `west` configure. Read
    // whichever casing is populated and write that same casing back, preserving
    // the full existing value with the discovered dirs prepended.
    const existing = env.Path ?? env.PATH ?? '';
    const updated = prepend.join(sep) + sep + existing;
    if (env.Path !== undefined || (env.PATH === undefined && process.platform === 'win32')) {
      env.Path = updated;
    } else {
      env.PATH = updated;
    }
  }
  return env;
}

/**
 * Build a spawn invocation that runs `west <westArgs>`.
 *
 * `baseOptions` carries the cwd/timeout/stdio settings the caller wants;
 * westSpawn preserves them and injects the discovery env. The returned object
 * destructures directly into spawnSync:
 *
 *   const inv = westSpawn(['build', '-b', 'xiao_ble', projectRoot], { cwd, timeout });
 *   spawnSync(inv.command, inv.args, inv.options);
 *
 * Throws a clear, actionable error when no usable west install is discovered.
 */
export function westSpawn(
  westArgs: string[],
  baseOptions: SpawnSyncOptions,
): WestInvocation {
  const install = discoverWest();
  if (!install) {
    throw new Error(
      [
        'west (the Zephyr build tool) was not found.',
        '',
        'typecad-hal looked for it on PATH, in $ZEPHYR_BASE/.venv, in common',
        'Zephyr workspace dirs (~/zephyrproject/.venv), and as a system',
        "Python module (`python -m west`). To fix:",
        '',
        '  • Run the typeCAD Zephyr installer (one command, any OS — needs Node ≥18):',
        '      node packages/zephyr-installer/install.mjs',
        '    then `micromamba activate zephyr` and retry.',
        '  • Or activate an existing Zephyr venv in this shell, or',
        '  • Or set ZEPHYR_BASE to your Zephyr SDK root (the venv at $ZEPHYR_BASE/../.venv is then used), or',
        '  • Or install west into a discoverable Python: pip install west',
        '',
        'See https://docs.zephyrproject.org/latest/develop/getting_started/index.html',
      ].join('\n'),
    );
  }

  const env = buildEnv(install);
  // Strip `shell` if present — we pass absolute paths / known commands, and
  // an explicit shell changes arg-quoting semantics on Windows.
  const { shell: _drop, ...optsWithoutShell } = baseOptions as any;

  if (install.mode === 'micromamba' && install.micromambaExe) {
    // `micromamba run -n <env> west …` sets up the env's full PATH
    // (cmake/ninja/dtc) and runs the activation hook (ZEPHYR_BASE /
    // ZEPHYR_SDK_INSTALL_DIR), so typecad-hal builds work WITHOUT the user
    // activating the env. Inject MAMBA_ROOT_PREFIX so micromamba finds envs.
    const mmEnv = { ...env };
    if (install.mambaRootPrefix) mmEnv.MAMBA_ROOT_PREFIX = install.mambaRootPrefix;
    return {
      command: install.micromambaExe,
      args: ['run', '-n', install.envName ?? 'zephyr', 'west', ...westArgs],
      options: { ...optsWithoutShell, env: mmEnv },
      install,
    };
  }

  if (install.mode === 'launcher' && install.westExecutable) {
    return {
      command: install.westExecutable,
      args: westArgs,
      options: { ...optsWithoutShell, env },
      install,
    };
  }

  // module mode: <python> -m west <args>
  const py = install.pythonExecutable!;
  return {
    command: py,
    args: ['-m', 'west', ...westArgs],
    options: { ...optsWithoutShell, env },
    install,
  };
}
